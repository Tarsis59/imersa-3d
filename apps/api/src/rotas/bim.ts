import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';
import { sugerirVinculos, type EspacoBim } from '../dominio/vinculo-bim';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
}

const NovaConversao = z.object({ arquivoId: z.uuid() });
const PorConversao = z.object({ conversaoId: z.uuid() });
const Vinculos = z.object({
  conversaoId: z.uuid(),
  vinculos: z.array(z.object({ unidadeId: z.uuid(), espacoGuid: z.string().regex(/^[0-9A-Za-z_$]{22}$/).nullable() })).max(5000),
});
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

type Metadados = { andares?: Array<{ guid: string; nome: string; elevacao_m: number }>; espacos?: Array<EspacoBim & { andar_guid: string | null; area_m2: number | null }> };

export function rotasBim(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  /** IFC do projeto → fila de conversão (o worker gera o 3D otimizado e lê pavimentos, ambientes e áreas). */
  app.post('/projetos/:id/conversoes', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const { arquivoId } = NovaConversao.parse(req.body);
    const nova = await withTenant(pool, ctx(s), async (c) => {
      const a = (await c.query<{ tipo: string; status: string; project_id: string }>('SELECT tipo, status, project_id FROM assets WHERE id = $1', [arquivoId])).rows[0];
      if (!a || a.project_id !== id) throw new ErroHttp(404, 'nao_encontrado');
      if (a.tipo !== 'ifc' || a.status !== 'pronto') throw new ErroHttp(400, 'arquivo_invalido_para_bim');
      try {
        const r = (await c.query<{ id: string }>('INSERT INTO conversoes_bim (project_id, arquivo_id) VALUES ($1, $2) RETURNING id', [id, arquivoId])).rows[0]!;
        await registrarAuditoria(c, { userId: s.userId, acao: 'bim.converter', entidade: 'conversao_bim', entidadeId: r.id, depois: { arquivo: arquivoId } });
        return r;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ErroHttp(409, 'conversao_em_andamento');
        throw e;
      }
    });
    return reply.status(201).send(nova);
  });

  app.get('/projetos/:id/conversoes', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM projects WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      return (
        await c.query(
          `SELECT v.id, v.status, v.mensagem, v.glb_asset_id AS "glbArquivoId", v.criado_em AS "criadoEm", a.nome AS "arquivoNome", v.arquivo_id AS "arquivoId",
                  jsonb_array_length(coalesce(v.metadados->'andares', '[]')) AS andares,
                  jsonb_array_length(coalesce(v.metadados->'espacos', '[]')) AS ambientes,
                  (v.metadados->>'bytesOriginal')::bigint AS "bytesOriginal", (v.metadados->>'bytes')::bigint AS bytes
             FROM conversoes_bim v JOIN assets a ON a.id = v.arquivo_id
            WHERE v.project_id = $1 ORDER BY v.criado_em DESC`,
          [id],
        )
      ).rows;
    });
  });

  async function conversaoPronta(c: pg.PoolClient, conversaoId: string, predioId: string) {
    const v = (
      await c.query<{ metadados: Metadados; glb: string | null; status: string }>(
        `SELECT v.metadados, v.glb_asset_id AS glb, v.status FROM conversoes_bim v JOIN buildings b ON b.project_id = v.project_id
          WHERE v.id = $1 AND b.id = $2`,
        [conversaoId, predioId],
      )
    ).rows[0];
    if (!v) throw new ErroHttp(404, 'nao_encontrado');
    if (v.status !== 'pronto' || !v.glb) throw new ErroHttp(409, 'conversao_nao_pronta');
    return { espacos: v.metadados.espacos ?? [], andares: v.metadados.andares ?? [], glb: v.glb };
  }

  /** Tela de vínculo: ambientes do BIM, unidades do prédio e as sugestões automáticas. */
  app.get('/predios/:id/vinculos-bim', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const { conversaoId } = PorConversao.parse(req.query);
    return withTenant(pool, ctx(s), async (c) => {
      const v = await conversaoPronta(c, conversaoId, id);
      const unidades = (
        await c.query<{ id: string; codigo: string; andar: number; meshNodeId: string | null }>(
          'SELECT u.id, u.codigo, f.numero AS andar, u.mesh_node_id AS "meshNodeId" FROM units u JOIN floors f ON f.id = u.floor_id WHERE u.building_id = $1 ORDER BY f.numero, u.codigo',
          [id],
        )
      ).rows;
      const nomeAndar = new Map(v.andares.map((a) => [a.guid, a.nome]));
      return {
        glbArquivoId: v.glb,
        espacos: v.espacos.map((e) => ({ guid: e.guid, nome: e.nome, nomeLongo: e.nome_longo, andar: e.andar_guid ? (nomeAndar.get(e.andar_guid) ?? null) : null, areaM2: e.area_m2 })),
        unidades,
        sugestoes: sugerirVinculos(v.espacos, unidades),
      };
    });
  });

  /** Grava os vínculos e liga o modelo convertido ao prédio (as unidades vinculadas acendem na cor do status). */
  app.post('/predios/:id/vinculos-bim', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = Vinculos.parse(req.body);
    return withTenant(pool, ctx(s), async (c) => {
      const v = await conversaoPronta(c, d.conversaoId, id);
      const guids = new Set(v.espacos.map((e) => e.guid));
      const escolhidos = d.vinculos.flatMap((x) => (x.espacoGuid ? [x.espacoGuid] : []));
      if (escolhidos.some((g) => !guids.has(g))) throw new ErroHttp(400, 'ambiente_inexistente');
      if (new Set(escolhidos).size !== escolhidos.length) throw new ErroHttp(400, 'ambiente_repetido');
      const ids = d.vinculos.map((x) => x.unidadeId);
      const doPredio = (await c.query<{ id: string }>('SELECT id FROM units WHERE building_id = $1 AND id = ANY($2::uuid[])', [id, ids])).rows.length;
      if (doPredio !== new Set(ids).size) throw new ErroHttp(400, 'unidade_de_outro_predio');
      // novo modelo: os vínculos antigos (de outro arquivo) não valem mais
      await c.query('UPDATE units SET mesh_node_id = NULL WHERE building_id = $1', [id]);
      for (const x of d.vinculos) if (x.espacoGuid) await c.query('UPDATE units SET mesh_node_id = $2 WHERE id = $1', [x.unidadeId, x.espacoGuid]);
      await c.query('UPDATE buildings SET modelo_asset_id = $2 WHERE id = $1', [id, v.glb]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'bim.vincular', entidade: 'building', entidadeId: id, depois: { conversao: d.conversaoId, vinculadas: escolhidos.length } });
      return { vinculadas: escolhidos.length, modeloArquivoId: v.glb };
    });
  });
}
