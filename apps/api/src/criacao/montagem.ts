import type pg from 'pg';
import { withTenant } from '@imersa/db';
import { registrarAuditoria } from '../auditoria';
import type { Sessao } from '../auth/tokens';
import { validarPlanilha } from '../dominio/planilha';
import { aplicarPlanilha } from '../importar';
import type { ServicosMapa } from '../mapa/osm';
import { criarEntorno, importarPoisOsm } from '../rotas/mapa';
import { giroParaOlhar, recuoDaRua, ruaMaisPerto } from '../mapa/malha';
import { localParaLatLon } from '../mapa/relevo';
import { centroDosGps, consultasDoTexto, limparCep, noBrasil, type LocalAchado, type Ponto } from './local';
import { planoDoPredio, posicionarLazer } from './plano';
import { normalizar, type Descricao } from './texto';

export const ETAPAS = ['texto', 'local', 'predio', 'lazer', 'cidade', 'pontos', 'arquivos'] as const;
export type IdEtapa = (typeof ETAPAS)[number];
export type EstadoEtapa = 'pendente' | 'rodando' | 'feita' | 'pulada' | 'aviso' | 'falhou';
export interface Etapa {
  id: IdEtapa;
  estado: EstadoEtapa;
  detalhe: string | null;
  ms: number | null;
}

/** Papel de cada arquivo na criação (o classificador sugere, a pessoa confirma). */
export const PAPEIS = ['foto', 'render', 'fachada', 'planta', 'documento', 'ifc', 'modelo', 'splat', 'captura'] as const;
export type Papel = (typeof PAPEIS)[number];

export interface Pistas {
  /** Lugar escolhido na tela (resultado da busca de endereço). */
  local?: { lat: number; lon: number; rotulo: string } | null;
  /** GPS das fotos (lido no navegador, só os números). */
  gps?: Ponto[];
  cep?: string | null;
}

export interface DepsMontagem {
  pool: pg.Pool;
  mapa: ServicosMapa;
}

/** Montagens rodando nesta instância (a rota não espera; os testes esperam por aqui). */
export const montagensRodando = new Map<string, Promise<void>>();

const RAIO_POIS_M = 1000;
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

class Falha extends Error {}
class Aviso extends Error {}

/**
 * Endereço → coordenada pelo Nominatim, com cache por empresa (o limite de uso é 1 pedido/s). Só aceita resultado
 * no Brasil. Erro do serviço volta como `null` (a etapa vira aviso, nunca derruba a montagem).
 */
async function geocodificar(d: DepsMontagem, s: Sessao, consulta: string): Promise<{ lat: number; lon: number; rotulo: string } | null> {
  const chave = normalizar(consulta).slice(0, 400);
  const cache = await withTenant(d.pool, ctx(s), async (c) => (await c.query<{ resultados: Array<{ lat: number; lon: number; rotulo: string }> }>('SELECT resultados FROM geocodificacoes WHERE consulta = $1', [chave])).rows[0]);
  let resultados = cache?.resultados;
  if (!resultados) {
    let achados;
    try {
      achados = await d.mapa.buscarEndereco(consulta);
    } catch {
      return null;
    }
    resultados = achados;
    await withTenant(d.pool, ctx(s), (c) =>
      c.query('INSERT INTO geocodificacoes (consulta, resultados) VALUES ($1, $2::jsonb) ON CONFLICT (tenant_id, consulta) DO UPDATE SET resultados = EXCLUDED.resultados, criado_em = now()', [
        chave,
        JSON.stringify(achados.slice(0, 5)),
      ]),
    );
  }
  return resultados?.find((r) => noBrasil(r)) ?? null;
}

/** Acha o lugar: escolhido na tela → GPS das fotos → endereço do texto → CEP → só a cidade (aproximado). */
export async function acharLocal(d: DepsMontagem, s: Sessao, desc: Descricao, pistas: Pistas): Promise<LocalAchado | null> {
  if (pistas.local && noBrasil(pistas.local)) return { ...pistas.local, fonte: 'escolhido' };
  const gps = centroDosGps(pistas.gps ?? []);
  if (gps && noBrasil(gps)) return { ...gps, fonte: 'gps', rotulo: 'Pelo GPS das fotos' };
  for (const q of consultasDoTexto(desc)) {
    const r = await geocodificar(d, s, q.consulta);
    if (r) return { ...r, fonte: q.fonte };
  }
  const cep = limparCep(pistas.cep ?? desc.cep);
  if (cep && d.mapa.buscarCep) {
    let e = null;
    try {
      e = await d.mapa.buscarCep(cep);
    } catch {
      e = null;
    }
    if (e) {
      const rua = [e.logradouro, e.bairro].filter(Boolean).join(', ');
      const r = (rua ? await geocodificar(d, s, `${rua}, ${e.localidade} - ${e.uf}`) : null) ?? (await geocodificar(d, s, `${e.localidade} - ${e.uf}`));
      if (r) return { ...r, fonte: rua ? 'cep' : 'cidade' };
    }
  }
  if (desc.cidade) {
    const r = await geocodificar(d, s, [desc.cidade, desc.uf].filter(Boolean).join(' - '));
    if (r) return { ...r, fonte: 'cidade' };
  }
  return null;
}

/**
 * Prédio sem modelo (fachada procedural): vira a entrada para a rua de carro mais perto e, se o ponto do endereço caiu
 * na rua, recua o prédio para trás da calçada (Plano 11b, item 9). Devolve o nome da rua, ou null se não mexeu.
 */
async function assentarNaRua(d: DepsMontagem, s: Sessao, projetoId: string, centro: { lat: number; lon: number }, vias: Parameters<typeof ruaMaisPerto>[0]): Promise<string | null> {
  const rua = ruaMaisPerto(vias, centro);
  if (!rua || rua.distanciaM > 120) return null;
  return withTenant(d.pool, ctx(s), async (c) => {
    const p = (
      await c.query<{ modelos: number; por_andar: number }>(
        `SELECT (SELECT count(*)::int FROM buildings WHERE project_id = $1 AND modelo_asset_id IS NOT NULL) AS modelos,
                coalesce((SELECT max(n) FROM (SELECT count(*)::int AS n FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.project_id = $1 GROUP BY u.floor_id) x), 4) AS por_andar`,
        [projetoId],
      )
    ).rows[0]!;
    if (p.modelos > 0) return null; // modelo de verdade: a posição e o giro são do projeto
    const colunas = Math.ceil(Math.sqrt(p.por_andar));
    const meia = (Math.max(colunas, Math.ceil(p.por_andar / colunas)) * 8) / 2;
    const novo = recuoDaRua(rua, meia);
    const lugar = novo ? localParaLatLon(centro, novo.x, novo.z) : centro;
    const alvo = novo ? { x: rua.ponto.x - novo.x, z: rua.ponto.z - novo.z } : rua.ponto;
    const giro = giroParaOlhar(alvo);
    await c.query('UPDATE projects SET rotacao_graus = $2, geom = ST_SetSRID(ST_MakePoint($4, $3), 4326) WHERE id = $1', [projetoId, giro, lugar.lat, lugar.lon]);
    await registrarAuditoria(c, { userId: s.userId, acao: 'projeto.assentar', entidade: 'project', entidadeId: projetoId, depois: { giro, recuoM: novo ? Math.round(Math.hypot(novo.x, novo.z)) : 0, rua: rua.via.nome } });
    return rua.via.nome ?? 'a rua';
  });
}

interface Linha {
  project_id: string;
  descricao: Descricao;
  pistas: Pistas;
  planilha: string | null;
  arquivos: Array<{ id: string; papel: Papel; lat?: number; lon?: number; rumo?: number }>;
}

/**
 * Roda a montagem inteira. Cada etapa grava o estado (a tela mostra ao vivo) e é segura para rodar de novo: o que já
 * existe (lugar, unidades, lazer) não é refeito. Só a falha do prédio derruba o resultado; o resto vira aviso.
 */
export async function executarMontagem(d: DepsMontagem, s: Sessao, montagemId: string): Promise<void> {
  const m = await withTenant(d.pool, ctx(s), async (c) => (await c.query<Linha>('SELECT project_id, descricao, pistas, planilha, arquivos FROM montagens WHERE id = $1', [montagemId])).rows[0]);
  if (!m) return;
  const projetoId = m.project_id;
  const desc = m.descricao;
  const etapas: Etapa[] = ETAPAS.map((id) => ({ id, estado: 'pendente', detalhe: null, ms: null }));
  const gravar = (extra = '') =>
    withTenant(d.pool, ctx(s), (c) => c.query(`UPDATE montagens SET etapas = $2::jsonb${extra} WHERE id = $1`, [montagemId, JSON.stringify(etapas)]));

  async function etapa(id: IdEtapa, fn: () => Promise<{ estado?: EstadoEtapa; detalhe: string }>): Promise<void> {
    const e = etapas.find((x) => x.id === id)!;
    e.estado = 'rodando';
    await gravar();
    const t0 = Date.now();
    try {
      const r = await fn();
      e.estado = r.estado ?? 'feita';
      e.detalhe = r.detalhe;
    } catch (erro) {
      e.estado = erro instanceof Aviso ? 'aviso' : 'falhou';
      e.detalhe = erro instanceof Falha || erro instanceof Aviso ? erro.message : 'Erro inesperado nesta etapa.';
    }
    e.ms = Date.now() - t0;
    await gravar();
  }

  await etapa('texto', async () => {
    const partes = [
      desc.andares !== null ? `${desc.andares} andares` : null,
      desc.unidadesPorAndar !== null ? `${desc.unidadesPorAndar} por andar` : null,
      desc.tipologias.length ? desc.tipologias.map((t) => t.nome).join(', ') : null,
      desc.lazer.length ? `lazer: ${desc.lazer.map((l) => l.nome.toLowerCase()).join(', ')}` : null,
    ].filter(Boolean);
    return { detalhe: partes.length ? partes.join(' · ') : 'Sem texto: o prédio sai da planilha ou dos arquivos.', estado: partes.length || m.planilha ? 'feita' : 'pulada' };
  });

  await etapa('local', async () => {
    const atual = await withTenant(d.pool, ctx(s), async (c) => (await c.query<{ tem: boolean }>('SELECT geom IS NOT NULL AS tem FROM projects WHERE id = $1', [projetoId])).rows[0]!);
    if (atual.tem && !m.pistas.local) return { estado: 'pulada', detalhe: 'O empreendimento já tinha localização.' };
    const l = await acharLocal(d, s, desc, m.pistas);
    if (!l) throw new Aviso('Não deu para achar o lugar pelo texto nem pelas fotos. Informe o CEP e retome.');
    await withTenant(d.pool, ctx(s), async (c) => {
      await c.query(
        `UPDATE projects SET geom = ST_SetSRID(ST_MakePoint($3, $2), 4326), endereco = coalesce($4, endereco), cidade = coalesce($5, cidade), uf = coalesce($6, uf) WHERE id = $1`,
        [projetoId, l.lat, l.lon, (desc.endereco ? [desc.endereco, desc.bairro].filter(Boolean).join(', ') : l.fonte === 'escolhido' ? l.rotulo : null)?.slice(0, 300) ?? null, desc.cidade?.slice(0, 120) ?? null, desc.uf],
      );
      await registrarAuditoria(c, { userId: s.userId, acao: 'projeto.localizar', entidade: 'project', entidadeId: projetoId, depois: { fonte: l.fonte, lat: l.lat, lon: l.lon } });
    });
    const como = { escolhido: 'endereço escolhido', gps: 'GPS das fotos', endereco: 'endereço do texto', cep: 'CEP', cidade: 'cidade (aproximado)' }[l.fonte];
    return { estado: l.fonte === 'cidade' ? 'aviso' : 'feita', detalhe: `Achado pelo ${como}${l.fonte === 'cidade' ? ': confira o ponto no mapa do empreendimento' : ''}.` };
  });

  await etapa('predio', async () => {
    const ja = await withTenant(d.pool, ctx(s), async (c) => (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.project_id = $1', [projetoId])).rows[0]!.n);
    if (ja > 0) return { estado: 'pulada', detalhe: `O empreendimento já tinha ${ja} unidades.` };
    let linhas;
    let origem: string;
    if (m.planilha) {
      const v = validarPlanilha(m.planilha);
      if (v.erros.length) throw new Falha(`A planilha tem ${v.erros.length} erro(s): linha ${v.erros[0]!.linha}, ${v.erros[0]!.campo}: ${v.erros[0]!.mensagem}.`);
      linhas = v.linhas;
      origem = 'da planilha';
    } else {
      const plano = planoDoPredio(desc);
      if (!plano) throw new Falha('Faltou dizer quantos andares o prédio tem (ou mandar a planilha de unidades).');
      linhas = plano.linhas;
      origem = 'pelo texto';
    }
    const r = await withTenant(d.pool, ctx(s), async (c) => {
      const res = await aplicarPlanilha(c, projetoId, linhas, s);
      if (res.erros.length) throw new Falha(`Não deu para gravar as unidades: ${res.erros[0]!.mensagem}.`);
      await registrarAuditoria(c, { userId: s.userId, acao: 'montagem.predio', entidade: 'project', entidadeId: projetoId, depois: res.resumo });
      return res.resumo;
    });
    return { detalhe: `${r.unidadesNovas} unidades em ${r.andaresNovos} andares (${r.prediosNovos} ${r.prediosNovos === 1 ? 'prédio' : 'prédios'}, ${r.tipologiasNovas} tipologias), ${origem}.` };
  });

  await etapa('lazer', async () => {
    if (!desc.lazer.length) return { estado: 'pulada', detalhe: 'O texto não cita lazer.' };
    const n = await withTenant(d.pool, ctx(s), async (c) => {
      const predios = (
        await c.query<{ id: string; andares: number; por_andar: number; lazer: number }>(
          `SELECT b.id, count(DISTINCT f.id)::int AS andares,
                  coalesce((SELECT max(x.n) FROM (SELECT count(*)::int AS n FROM units u2 WHERE u2.building_id = b.id GROUP BY u2.floor_id) x), 0) AS por_andar,
                  (SELECT count(*)::int FROM lazer l WHERE l.building_id = b.id) AS lazer
             FROM buildings b LEFT JOIN floors f ON f.building_id = b.id AND f.numero >= 0
            WHERE b.project_id = $1 GROUP BY b.id ORDER BY b.nome`,
          [projetoId],
        )
      ).rows;
      let criados = 0;
      for (const p of predios) {
        if (p.lazer > 0 || p.por_andar === 0) continue;
        for (const l of posicionarLazer(desc.lazer, p.por_andar, p.andares)) {
          await c.query('INSERT INTO lazer (building_id, categoria, nome, x_m, y_m, z_m, ordem) VALUES ($1, $2, $3, $4, $5, $6, $7)', [p.id, l.categoria, l.nome, l.x, l.y, l.z, l.ordem]);
          criados++;
        }
      }
      return criados;
    });
    if (!n) return { estado: 'pulada', detalhe: 'O lazer já estava marcado.' };
    return { detalhe: `${desc.lazer.length} espaços marcados no 3D, com o tour "Conheça o lazer" pronto (a gestão ajusta a posição).` };
  });

  const temLocal = async () => withTenant(d.pool, ctx(s), async (c) => (await c.query<{ tem: boolean }>('SELECT geom IS NOT NULL AS tem FROM projects WHERE id = $1', [projetoId])).rows[0]!.tem);

  await etapa('cidade', async () => {
    if (!(await temLocal())) return { estado: 'pulada', detalhe: 'Sem localização, sem cidade em volta.' };
    let e;
    try {
      e = await criarEntorno(d.pool, d.mapa).obter(ctx(s), projetoId);
    } catch {
      throw new Aviso('O mapa da cidade não respondeu agora: abra o 3D mais tarde que ele busca de novo.');
    }
    const partes = [`${e.predios.length} prédios reais`];
    if (e.vias.length) partes.push(`${e.vias.length} ruas e calçadas`);
    if (e.areas.length) partes.push(`${e.areas.length} áreas verdes e de água`);
    if (e.relevo) partes.push('o relevo do terreno');
    const virada = e.centro ? await assentarNaRua(d, s, projetoId, e.centro, e.vias) : null;
    return { detalhe: `${partes.join(', ')} em volta${virada ? `; fachada virada para ${virada}` : ''}.` };
  });

  await etapa('pontos', async () => {
    if (!(await temLocal())) return { estado: 'pulada', detalhe: 'Sem localização, sem pontos próximos.' };
    try {
      const r = await importarPoisOsm(d.pool, d.mapa, ctx(s), projetoId, RAIO_POIS_M);
      return { detalhe: `${r.encontrados} escolas, mercados, farmácias, transporte e parques em até 1 km.` };
    } catch {
      throw new Aviso('O mapa não respondeu para os pontos próximos: importe depois no empreendimento.');
    }
  });

  await etapa('arquivos', async () => {
    if (!m.arquivos.length) return { estado: 'pulada', detalhe: 'Nenhum arquivo enviado.' };
    const feito = await withTenant(d.pool, ctx(s), async (c) => {
      const conta: Record<string, number> = {};
      const mais = (k: string) => (conta[k] = (conta[k] ?? 0) + 1);
      const primeiro = (await c.query<{ id: string; modelo: string | null }>('SELECT id, modelo_asset_id AS modelo FROM buildings WHERE project_id = $1 ORDER BY nome LIMIT 1', [projetoId])).rows[0];
      for (const a of m.arquivos) {
        const arq = (await c.query<{ tipo: string; status: string; nome: string }>('SELECT tipo, status, nome FROM assets WHERE id = $1 AND project_id = $2', [a.id, projetoId])).rows[0];
        if (!arq || arq.status !== 'pronto') {
          mais('recusado');
          continue;
        }
        await c.query('SAVEPOINT arquivo');
        try {
          // papel confirmado e, na foto com GPS, onde foi tirada (o 3D põe um quadro ali)
          const comGps = a.lat !== undefined && a.lon !== undefined;
          await c.query('UPDATE assets SET papel = $2, lat = $3, lon = $4, rumo = $5 WHERE id = $1', [a.id, a.papel, comGps ? a.lat : null, comGps ? a.lon : null, comGps ? (a.rumo ?? null) : null]);
          if (a.papel === 'ifc' && arq.tipo === 'ifc') {
            await c.query('INSERT INTO conversoes_bim (project_id, arquivo_id) VALUES ($1, $2)', [projetoId, a.id]);
            mais('bim');
          } else if (a.papel === 'planta' && arq.tipo === 'planta' && !/\.dwg$/i.test(arq.nome)) {
            await c.query('INSERT INTO plantas (project_id, arquivo_id) VALUES ($1, $2)', [projetoId, a.id]);
            mais('planta');
          } else if (a.papel === 'captura' && arq.tipo === 'captura') {
            await c.query("INSERT INTO capturas (project_id, arquivo_id, nome, status) VALUES ($1, $2, $3, 'na_fila')", [projetoId, a.id, `Captura: ${arq.nome}`.slice(0, 120)]);
            mais('captura');
          } else if (a.papel === 'modelo' && arq.tipo === 'modelo_3d' && primeiro && !primeiro.modelo) {
            await c.query('UPDATE buildings SET modelo_asset_id = $2 WHERE id = $1', [primeiro.id, a.id]);
            primeiro.modelo = a.id;
            mais('modelo');
          } else mais('guardado');
          await c.query('RELEASE SAVEPOINT arquivo');
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT arquivo');
          // já na fila (rodou de novo): conta como feito
          if ((e as { code?: string }).code === '23505') mais(a.papel === 'ifc' ? 'bim' : a.papel === 'planta' ? 'planta' : 'guardado');
          else mais('recusado');
        }
      }
      await registrarAuditoria(c, { userId: s.userId, acao: 'montagem.arquivos', entidade: 'project', entidadeId: projetoId, depois: conta });
      return conta;
    });
    const partes = [
      feito.bim ? `${feito.bim} projeto BIM na fila de conversão` : null,
      feito.planta ? `${feito.planta} planta${feito.planta > 1 ? 's' : ''} na fila de leitura` : null,
      feito.captura ? `${feito.captura} captura${feito.captura > 1 ? 's' : ''} na fila do 3D real (GPU)` : null,
      feito.modelo ? 'modelo 3D ligado ao prédio' : null,
      feito.guardado ? `${feito.guardado} guardado${feito.guardado > 1 ? 's' : ''} nos arquivos do empreendimento` : null,
      feito.recusado ? `${feito.recusado} não ${feito.recusado > 1 ? 'puderam' : 'pôde'} ser usado${feito.recusado > 1 ? 's' : ''} (envio incompleto ou recusado)` : null,
    ].filter(Boolean);
    return { estado: feito.recusado ? 'aviso' : 'feita', detalhe: `${partes.join('; ')}.` };
  });

  const falhouPredio = etapas.find((e) => e.id === 'predio')!.estado === 'falhou';
  const comAviso = etapas.some((e) => e.estado === 'aviso' || e.estado === 'falhou');
  await gravar(`, estado = '${falhouPredio ? 'falhou' : comAviso ? 'pronta_com_avisos' : 'pronta'}', concluida_em = now()`);
}
