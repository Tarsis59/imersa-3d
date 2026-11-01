import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import type pg from 'pg';
import { withTenant } from '@imersa/db';
import type { Armazenamento } from '../arquivos/armazenamento';
import { nomeSeguro } from '../arquivos/tipos';
import { glbParaBlender, ModeloSemRender } from '../giros/descomprimir';

export const FORMATOS_VIDEO = ['9:16', '1:1', '16:9'] as const;
export type FormatoVideo = (typeof FORMATOS_VIDEO)[number];

export type ResultadoVideo =
  | {
      ok: true;
      video: string;
      capa: string | null;
      formato: string;
      largura: number;
      altura: number;
      segundos: number;
      selo: string;
      dispositivo: string;
      mb: number;
      tempos_s?: Record<string, number>;
      /** Locução feita (voz, duração, frases e como foi a legenda). */
      narracao?: Record<string, unknown>;
    }
  | { ok: false; erro: string; mensagem: string };

/**
 * Quem faz o vídeo. Hoje, o Blender (grátis e fiel ao projeto); um provedor de vídeo com IA entraria como outro
 * `ProvedorVideo` com a mesma entrada e a mesma saída (MP4 + selo), sem mudar fila, telas nem armazenamento.
 */
export type ProvedorVideo = (e: { glb: string; formato: FormatoVideo; id: string; pasta: string; narracao: Narracao | null }) => Promise<ResultadoVideo>;
export interface Narracao {
  voz: string;
  texto: string;
}

export interface DepsVideo {
  pool: pg.Pool;
  armazenamento: Armazenamento;
  provedor: ProvedorVideo;
  pastaTrabalho: string;
  intervaloSinalMs?: number;
}

const TRANSITORIOS = new Set(['falha_na_gpu', 'tempo_esgotado', 'falha_inesperada', 'falha_no_render', 'sem_internet', 'falha_na_narracao']);
const MAX_TENTATIVAS = 2;
const SELO = 'Imagem ilustrativa';
const falhaInesperada = (mensagem: string): ResultadoVideo => ({ ok: false, erro: 'falha_inesperada', mensagem });
const nomeFormato: Record<FormatoVideo, string> = { '9:16': 'reels-stories', '1:1': 'feed-whatsapp', '16:9': 'paisagem' };

/** Pega o próximo vídeo da fila (de qualquer empresa) e renderiza. */
export async function processarProximoVideo(d: DepsVideo): Promise<'vazia' | 'ok' | 'erro'> {
  const alvo = (await d.pool.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM pegar_proximo_video()')).rows[0];
  if (!alvo) return 'vazia';
  const ctx = { tenantId: alvo.tenant_id, userId: null };
  const v = await withTenant(d.pool, ctx, async (c) =>
    (
      await c.query<{ building_id: string; formato: FormatoVideo; tentativas: number; project_id: string; predio: string; chave: string; narracao: Narracao | null }>(
        `SELECT v.building_id, v.formato, v.tentativas, v.narracao, b.project_id, b.nome AS predio, a.chave
           FROM videos v JOIN buildings b ON b.id = v.building_id JOIN assets a ON a.id = v.modelo_asset_id WHERE v.id = $1`,
        [alvo.id],
      )
    ).rows[0]!,
  );
  const pasta = join(d.pastaTrabalho, `video-${alvo.id}-t${v.tentativas}`);
  const sinal = setInterval(() => {
    void withTenant(d.pool, ctx, (c) => c.query("UPDATE videos SET trabalho_em = now() WHERE id = $1 AND status = 'processando'", [alvo.id])).catch(() => undefined);
  }, d.intervaloSinalMs ?? 60_000);
  try {
    await mkdir(pasta, { recursive: true });
    let r: ResultadoVideo;
    try {
      const glb = join(pasta, 'modelo.glb');
      await writeFile(glb, await glbParaBlender(new Uint8Array(await buffer(await d.armazenamento.abrirLeitura(v.chave)))));
      r = await d.provedor({ glb, formato: v.formato, id: `${alvo.id.slice(0, 8)}-t${v.tentativas}`, pasta, narracao: v.narracao });
    } catch (e) {
      r = e instanceof ModeloSemRender ? { ok: false, erro: 'modelo_invalido', mensagem: e.message } : falhaInesperada('Falha inesperada no render do vídeo. Uma nova tentativa será feita.');
    }
    // vídeo sem o selo não sai, venha de onde vier
    if (r.ok && r.selo !== SELO) r = { ok: false, erro: 'sem_selo', mensagem: 'O vídeo saiu sem o selo "Imagem ilustrativa" e foi descartado.' };
    // narração pedida e não feita: não entrega vídeo mudo como se estivesse certo
    if (r.ok && v.narracao && !r.narracao) r = { ok: false, erro: 'falha_na_narracao', mensagem: 'O vídeo saiu sem a narração pedida.' };

    if (r.ok) {
      const ok = r;
      const base = `${v.predio}-${nomeFormato[v.formato]}`;
      const salvar = async (arquivo: string, nome: string, tipoConteudo: string) => {
        const dados = await readFile(arquivo);
        const id = randomUUID();
        const chave = `${alvo.tenant_id}/${v.project_id}/${id}/${nomeSeguro(nome)}`;
        await d.armazenamento.salvar(chave, dados, tipoConteudo);
        return { id, chave, nome, tamanho: dados.length, sha: createHash('sha256').update(dados).digest('hex') };
      };
      const video = await salvar(ok.video, `${base}.mp4`, 'video/mp4');
      const capa = ok.capa ? await salvar(ok.capa, `${base}-capa.jpg`, 'image/jpeg') : null;
      const metricas = { largura: ok.largura, altura: ok.altura, segundos: ok.segundos, mb: ok.mb, dispositivo: ok.dispositivo, tempos_s: ok.tempos_s ?? {}, ...(ok.narracao ? { narracao: ok.narracao } : {}) };
      const gravou = await withTenant(d.pool, ctx, async (c) => {
        const st = (await c.query<{ status: string }>('SELECT status FROM videos WHERE id = $1 FOR UPDATE', [alvo.id])).rows[0]?.status;
        if (st !== 'processando') return false;
        for (const [a, tipo] of [[video, 'video'], [capa, 'imagem']] as const) {
          if (!a) continue;
          // gerado pelo próprio sistema a partir de um modelo já verificado: entra pronto
          await c.query(
            `INSERT INTO assets (id, project_id, tipo, nome, chave, tamanho_declarado, tamanho, sha256, status, verificado_antivirus)
             VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'pronto', false)`,
            [a.id, v.project_id, tipo, a.nome, a.chave, a.tamanho, a.sha],
          );
        }
        await c.query("UPDATE videos SET status = 'pronto', mensagem = NULL, video_asset_id = $2, capa_asset_id = $3, metricas = $4 WHERE id = $1", [
          alvo.id,
          video.id,
          capa?.id ?? null,
          JSON.stringify(metricas),
        ]);
        return true;
      });
      if (!gravou) for (const a of [video, capa]) if (a) await d.armazenamento.apagar(a.chave);
      return 'ok';
    }

    const repetir = TRANSITORIOS.has(r.erro) && v.tentativas < MAX_TENTATIVAS;
    await withTenant(d.pool, ctx, (c) =>
      c.query("UPDATE videos SET status = $2, mensagem = $3 WHERE id = $1 AND status = 'processando'", [alvo.id, repetir ? 'na_fila' : 'erro', r.mensagem.slice(0, 1000)]),
    );
    return 'erro';
  } finally {
    clearInterval(sinal);
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Blender Cycles na GPU gratuita do Kaggle (ou num Blender local): `python -m imersa_recon.filme`. */
export function provedorBlender(o: { python: string; diretorio: string; usuarioKaggle?: string; blender?: string; qualidade?: { segundos?: number; fps?: number; amostras?: number; escala?: number } }): ProvedorVideo {
  return (e) =>
    new Promise((ok) => {
      const resultado = join(e.pasta, 'resultado.json');
      const args = ['-m', 'imersa_recon.filme', '--glb', e.glb, '--formato', e.formato, '--id', e.id, '--saida', join(e.pasta, 'trabalho'), '--resultado', resultado];
      for (const [chave, valor] of Object.entries(o.qualidade ?? {})) if (valor !== undefined) args.push(`--${chave}`, String(valor));
      const pedido = join(e.pasta, 'narracao.json');
      if (e.narracao) args.push('--narracao', pedido);
      if (o.blender) args.push('--blender', o.blender);
      else args.push('--usuario', o.usuarioKaggle ?? '');
      // o roteiro vai num arquivo (texto livre não passa pela linha de comando)
      const preparar = e.narracao ? writeFile(pedido, JSON.stringify(e.narracao)) : Promise.resolve();
      preparar.then(
        () => {
          const p = spawn(o.python, args, { cwd: o.diretorio, stdio: 'ignore', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
          p.on('error', () => ok(falhaInesperada('Não foi possível iniciar o render do vídeo.')));
          p.on('close', () => {
            readFile(resultado, 'utf8')
              .then((t) => ok(JSON.parse(t) as ResultadoVideo))
              .catch(() => ok(falhaInesperada('O render do vídeo terminou sem resultado.')));
          });
        },
        () => ok(falhaInesperada('Não foi possível preparar a narração.')),
      );
    });
}

/** Para testes e demonstração sem GPU: devolve um vídeo pronto (já renderizado pelo Blender, com selo). */
export function provedorSimulado(video: string, capa: string | null): ProvedorVideo {
  return async (e) => {
    const destino = join(e.pasta, 'video.mp4');
    await copyFile(video, destino);
    let capaDestino: string | null = null;
    if (capa) {
      capaDestino = join(e.pasta, 'capa.jpg');
      await copyFile(capa, capaDestino);
    }
    const [largura, altura] = e.formato === '9:16' ? [1080, 1920] : e.formato === '1:1' ? [1080, 1080] : [1920, 1080];
    // narração simulada: o vídeo pronto não tem voz; registra o pedido (a voz de verdade é feita no Kaggle)
    const narracao = e.narracao ? { voz: e.narracao.voz, frases: e.narracao.texto.split(/(?<=[.!?])\s+/).length, legenda: 'simulada' } : undefined;
    return { ok: true, video: destino, capa: capaDestino, formato: e.formato, largura, altura, segundos: 10, selo: SELO, dispositivo: 'simulado', mb: 0, ...(narracao ? { narracao } : {}) };
  };
}
