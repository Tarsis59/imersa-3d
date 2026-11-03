import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';
import { conferirAssinatura } from '../arquivos/assinatura';
import { ArmazenamentoLocal, ErroLimite, type Armazenamento } from '../arquivos/armazenamento';
import type { Antivirus } from '../arquivos/antivirus';
import { BYTES_INICIO, conferirConteudo, nomeSeguro, tipoDeConteudo, TIPOS_ARQUIVO, validarDeclaracao } from '../arquivos/tipos';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
  armazenamento: Armazenamento;
  antivirus: Antivirus;
  segredo: string;
  limiteBytes: number;
}

const NovoArquivo = z.object({
  nome: z.string().trim().min(1).max(200),
  tipo: z.enum(TIPOS_ARQUIVO),
  tamanho: z.number().int().positive(),
});
const LinkAssinado = z.object({ t: z.uuid(), exp: z.coerce.number().int(), sig: z.string().min(10).max(100) });
const ModeloDoPredio = z.object({ arquivoId: z.uuid().nullable() });

const ENVIO_S = 3600;
const DOWNLOAD_S = 900;
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

interface Arquivo {
  chave: string;
  nome: string;
  tamanho_declarado: string;
  status: string;
  project_id: string;
}

export function rotasArquivos(app: FastifyInstance, d: Dependencias): void {
  const { pool, exigir, armazenamento, antivirus, segredo, limiteBytes } = d;

  async function rejeitar(tenantId: string, assetId: string, chave: string, motivo: string, tamanho: number | null, userId: string | null) {
    await armazenamento.apagar(chave);
    await withTenant(pool, { tenantId, userId }, async (c) => {
      await c.query("UPDATE assets SET status = 'rejeitado', motivo_rejeicao = $2, tamanho = $3 WHERE id = $1", [assetId, motivo, tamanho]);
      await registrarAuditoria(c, { userId, acao: 'arquivo.rejeitar', entidade: 'asset', entidadeId: assetId, depois: { motivo } });
    });
    return { status: 'rejeitado' as const, motivo };
  }

  /** Confere tamanho, assinatura binária e antivírus. Só então o arquivo fica `pronto`. */
  async function verificar(tenantId: string, assetId: string, userId: string | null, sha256: string | null) {
    const a = await withTenant(pool, { tenantId, userId }, async (c) =>
      (await c.query<Arquivo>('SELECT chave, nome, tamanho_declarado, status, project_id FROM assets WHERE id = $1', [assetId])).rows[0],
    );
    if (!a) throw new ErroHttp(404, 'nao_encontrado');
    const tamanho = await armazenamento.tamanho(a.chave);
    if (tamanho === null) throw new ErroHttp(409, 'arquivo_ainda_nao_enviado');
    if (tamanho > Number(a.tamanho_declarado)) return rejeitar(tenantId, assetId, a.chave, 'arquivo maior que o tamanho declarado', tamanho, userId);
    const erroTipo = conferirConteudo(a.nome, await armazenamento.lerInicio(a.chave, BYTES_INICIO), tamanho);
    if (erroTipo) return rejeitar(tenantId, assetId, a.chave, erroTipo, tamanho, userId);
    let av;
    try {
      av = await antivirus.verificar(await armazenamento.abrirLeitura(a.chave));
    } catch {
      throw new ErroHttp(503, 'antivirus_indisponivel');
    }
    if (!av.limpo) return rejeitar(tenantId, assetId, a.chave, `ameaça encontrada pelo antivírus: ${av.ameaca ?? 'desconhecida'}`, tamanho, userId);
    await withTenant(pool, { tenantId, userId }, async (c) => {
      await c.query("UPDATE assets SET status = 'pronto', tamanho = $2, sha256 = $3, verificado_antivirus = $4, motivo_rejeicao = NULL WHERE id = $1", [
        assetId,
        tamanho,
        sha256,
        av.verificado,
      ]);
      await registrarAuditoria(c, { userId, acao: 'arquivo.aprovar', entidade: 'asset', entidadeId: assetId, depois: { tamanho, antivirus: av.verificado } });
    });
    return { status: 'pronto' as const, motivo: null };
  }

  app.get('/projetos/:id/arquivos', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM projects WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      return (
        await c.query(
          `SELECT id, nome, tipo, status, motivo_rejeicao AS "motivoRejeicao", coalesce(tamanho, tamanho_declarado)::float8 AS tamanho,
                  verificado_antivirus AS "verificadoAntivirus", criado_em AS "criadoEm"
             FROM assets WHERE project_id = $1 AND status <> 'em_revisao' AND tipo NOT IN ('giro', 'video', 'bake') ORDER BY criado_em DESC`,
          [id],
        )
      ).rows;
    });
  });

  app.post('/projetos/:id/arquivos', async (req, reply) => {
    // fotos/vídeo de captura: quem está no imóvel (consultora, produtor) também envia
    const s = await exigir(req, (req.body as { tipo?: unknown } | null)?.tipo === 'captura' ? 'captura:enviar' : 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const n = NovoArquivo.parse(req.body);
    const erro = validarDeclaracao(n.tipo, n.nome, n.tamanho);
    if (erro) return reply.status(400).send({ erro: 'arquivo_invalido', mensagem: erro });
    const assetId = randomUUID();
    const chave = `${s.tenantId}/${id}/${assetId}/${nomeSeguro(n.nome)}`;
    await withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM projects WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      const usado = Number((await c.query<{ usado: string }>("SELECT coalesce(sum(coalesce(tamanho, tamanho_declarado)), 0) AS usado FROM assets WHERE status <> 'rejeitado'")).rows[0]!.usado);
      if (usado + n.tamanho > limiteBytes) throw new ErroHttp(413, 'limite_armazenamento');
      await c.query('INSERT INTO assets (id, project_id, tipo, nome, chave, tamanho_declarado, enviado_por) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        assetId,
        id,
        n.tipo,
        n.nome,
        chave,
        n.tamanho,
        s.userId,
      ]);
    });
    const envio = await armazenamento.urlEnvio({ chave, assetId, tenantId: s.tenantId, tipoConteudo: tipoDeConteudo(n.nome), expiraS: ENVIO_S });
    return reply.status(201).send({ id: assetId, envio });
  });

  // Envio local (só com ARMAZENAMENTO=local): o corpo é o arquivo bruto; quem autoriza é a assinatura do link.
  if (armazenamento instanceof ArmazenamentoLocal) {
    const local = armazenamento;
    void app.register(async (escopo) => {
      escopo.removeAllContentTypeParsers();
      escopo.addContentTypeParser('*', (_req, corpo, pronto) => pronto(null, corpo));
      escopo.put('/arquivos/:id/conteudo', async (req) => {
        const { id } = IdParam.parse(req.params);
        const q = LinkAssinado.parse(req.query);
        if (!conferirAssinatura(segredo, 'put', id, q.t, q.exp, q.sig)) throw new ErroHttp(403, 'link_invalido');
        const declaradoNoCabecalho = Number(req.headers['content-length']);
        const a = await withTenant(pool, { tenantId: q.t, userId: null }, async (c) =>
          (
            await c.query<Arquivo>(
              "UPDATE assets SET status = 'verificando' WHERE id = $1 AND status = 'aguardando_envio' RETURNING chave, nome, tamanho_declarado, status, project_id",
              [id],
            )
          ).rows[0],
        );
        if (!a) throw new ErroHttp(409, 'envio_ja_feito_ou_inexistente');
        const declarado = Number(a.tamanho_declarado);
        if (Number.isFinite(declaradoNoCabecalho) && declaradoNoCabecalho > declarado) {
          await rejeitar(q.t, id, a.chave, 'arquivo maior que o tamanho declarado', declaradoNoCabecalho, null);
          throw new ErroHttp(413, 'maior_que_o_declarado');
        }
        let gravado;
        try {
          gravado = await local.gravar(a.chave, req.body as Readable, declarado);
        } catch (e) {
          if (e instanceof ErroLimite) {
            await rejeitar(q.t, id, a.chave, 'arquivo maior que o tamanho declarado', null, null);
            throw new ErroHttp(413, 'maior_que_o_declarado');
          }
          await withTenant(pool, { tenantId: q.t, userId: null }, (c) => c.query("UPDATE assets SET status = 'aguardando_envio' WHERE id = $1", [id]));
          throw e;
        }
        return verificar(q.t, id, null, gravado.sha256);
      });
    });

    app.get('/arquivos/:id/conteudo', async (req, reply) => {
      const { id } = IdParam.parse(req.params);
      const q = LinkAssinado.parse(req.query);
      if (!conferirAssinatura(segredo, 'get', id, q.t, q.exp, q.sig)) throw new ErroHttp(403, 'link_invalido');
      const a = await withTenant(pool, { tenantId: q.t, userId: null }, async (c) =>
        // 'em_revisao': prévia de captura (o link assinado só é gerado para a gestão, na rota da captura)
        (await c.query<Arquivo & { tamanho: string }>("SELECT chave, nome, tamanho FROM assets WHERE id = $1 AND status IN ('pronto', 'em_revisao')", [id])).rows[0],
      );
      if (!a) throw new ErroHttp(404, 'nao_encontrado');
      return reply
        .header('content-type', tipoDeConteudo(a.nome))
        .header('content-length', a.tamanho)
        .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.nome)}`)
        .header('cross-origin-resource-policy', 'cross-origin')
        .header('cache-control', 'private, max-age=600')
        .send(await local.abrirLeitura(a.chave));
    });
  }

  // Envio direto ao S3: o navegador avisa que terminou e a API verifica.
  app.post('/arquivos/:id/concluir', async (req) => {
    const { id } = IdParam.parse(req.params);
    const a = await withTenant(pool, ctx(await exigir(req)), async (c) => (await c.query<{ status: string; tipo: string }>('SELECT status, tipo FROM assets WHERE id = $1', [id])).rows[0]);
    if (!a) throw new ErroHttp(404, 'nao_encontrado');
    // a mesma permissão de quem pode enviar esse tipo de arquivo
    const s = await exigir(req, a.tipo === 'captura' ? 'captura:enviar' : 'empreendimento:editar');
    const status = a.status;
    if (status === 'pronto' || status === 'rejeitado') return { status };
    return verificar(s.tenantId, id, s.userId, null);
  });

  app.get('/arquivos/:id/download', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    const a = await withTenant(pool, ctx(s), async (c) =>
      (await c.query<Arquivo>("SELECT chave, nome FROM assets WHERE id = $1 AND status = 'pronto'", [id])).rows[0],
    );
    if (!a) throw new ErroHttp(404, 'nao_encontrado');
    return { nome: a.nome, url: await armazenamento.urlDownload({ chave: a.chave, assetId: id, tenantId: s.tenantId, nomeArquivo: a.nome, expiraS: DOWNLOAD_S }) };
  });

  app.delete('/arquivos/:id', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    await withTenant(pool, ctx(s), async (c) => {
      const a = (await c.query<Arquivo>('DELETE FROM assets WHERE id = $1 RETURNING chave, nome', [id])).rows[0];
      if (!a) throw new ErroHttp(404, 'nao_encontrado');
      await armazenamento.apagar(a.chave);
      await registrarAuditoria(c, { userId: s.userId, acao: 'arquivo.apagar', entidade: 'asset', entidadeId: id, antes: { nome: a.nome } });
    });
    return reply.status(204).send();
  });

  app.patch('/predios/:id/modelo', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const { arquivoId } = ModeloDoPredio.parse(req.body);
    return withTenant(pool, ctx(s), async (c) => {
      const p = (await c.query<{ project_id: string }>('SELECT project_id FROM buildings WHERE id = $1', [id])).rows[0];
      if (!p) throw new ErroHttp(404, 'nao_encontrado');
      if (arquivoId) {
        const ok = await c.query("SELECT 1 FROM assets WHERE id = $1 AND project_id = $2 AND tipo = 'modelo_3d' AND status = 'pronto'", [arquivoId, p.project_id]);
        if (!ok.rowCount) throw new ErroHttp(400, 'arquivo_invalido_para_modelo');
      }
      await c.query('UPDATE buildings SET modelo_asset_id = $2 WHERE id = $1', [id, arquivoId]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'predio.modelo', entidade: 'building', entidadeId: id, depois: { arquivoId } });
      return { id, modeloArquivoId: arquivoId };
    });
  });
}
