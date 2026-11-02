import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import { ehGestao, type Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';
import { STATUS_UNIDADE, validarTransicao, type StatusUnidade } from '../dominio/status';
import { lerDxf } from '../loteamento/dxf';
import { lotesDoDxf, lotesDoGeoJson, type Leitura } from '../loteamento/lotes';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
}

/** Um DXF de loteamento grande (centenas de lotes com textos) passa de 1 MB; o limite fica folgado. */
const LIMITE_ARQUIVO = 15 * 1024 * 1024;
const Importacao = z.object({
  formato: z.enum(['dxf', 'geojson']),
  conteudo: z.string().min(10).max(LIMITE_ARQUIVO),
  /** Fuso UTM do levantamento (Brasil: 18 a 25). Sem fuso, o DXF está em graus. */
  fuso: z.number().int().min(18).max(25).optional(),
  sul: z.boolean().default(true),
  aplicar: z.boolean().default(false),
});
const EdicaoLote = z
  .object({ preco: z.number().finite().min(0).max(1e10).nullable().optional(), status: z.enum(STATUS_UNIDADE).optional(), motivo: z.string().trim().max(500).optional() })
  .refine((d) => d.preco !== undefined || d.status !== undefined, 'nada para mudar');
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

export interface Lote {
  id: string;
  quadra: string;
  numero: string;
  areaM2: number;
  frenteM: number | null;
  fundoM: number | null;
  preco: number | null;
  status: StatusUnidade;
  contorno: Array<[number, number]>;
}

/** Lotes do loteamento (painel, link do cliente e estande), em ordem de quadra e número. */
export async function lotesDoPredio(c: pg.PoolClient, predioId: string): Promise<Lote[]> {
  const r = await c.query<Omit<Lote, 'contorno'> & { geo: string }>(
    `SELECT id, quadra, numero, area_m2::float8 AS "areaM2", frente_m::float8 AS "frenteM", fundo_m::float8 AS "fundoM", preco::float8 AS preco, status,
            ST_AsGeoJSON(contorno, 8) AS geo
       FROM lotes WHERE building_id = $1`,
    [predioId],
  );
  const lotes = r.rows.map(({ geo, ...l }) => ({ ...l, contorno: (JSON.parse(geo) as { coordinates: Array<Array<[number, number]>> }).coordinates[0]!.slice(0, -1) }));
  return lotes.sort((a, b) => a.quadra.localeCompare(b.quadra, 'pt-BR', { numeric: true }) || a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

function resumo(l: Leitura) {
  return {
    lotes: l.lotes.length,
    quadras: [...new Set(l.lotes.map((x) => x.quadra))],
    areaTotalM2: Math.round(l.lotes.reduce((s, x) => s + x.areaM2, 0)),
    avisos: l.avisos.slice(0, 50),
    amostra: l.lotes.slice(0, 5).map(({ contorno: _c, ...x }) => x),
  };
}

export function rotasLotes(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  /** Importa o parcelamento: sem `aplicar`, só a prévia (nada é gravado). Reimportar mantém preço e situação. */
  app.post('/predios/:id/lotes/importar', { bodyLimit: LIMITE_ARQUIVO + 64 * 1024 }, async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = Importacao.parse(req.body);
    let leitura: Leitura;
    try {
      leitura = d.formato === 'dxf' ? lotesDoDxf(lerDxf(d.conteudo), { fuso: d.fuso, sul: d.sul }) : lotesDoGeoJson(JSON.parse(d.conteudo));
    } catch {
      throw new ErroHttp(400, 'arquivo_invalido');
    }
    const previa = resumo(leitura);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      if (!d.aplicar || !leitura.lotes.length) return { ...previa, aplicado: false };
      for (const l of leitura.lotes) {
        const anel = [...l.contorno, l.contorno[0]!];
        await c.query(
          `INSERT INTO lotes (building_id, quadra, numero, area_m2, frente_m, fundo_m, preco, status, contorno)
           VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::text, 'disponivel'), ST_SetSRID(ST_GeomFromGeoJSON($9), 4326))
           ON CONFLICT (building_id, quadra, numero) DO UPDATE SET area_m2 = EXCLUDED.area_m2, frente_m = EXCLUDED.frente_m, fundo_m = EXCLUDED.fundo_m,
             contorno = EXCLUDED.contorno, preco = coalesce($7, lotes.preco), status = coalesce($8::text, lotes.status), atualizado_em = now()`,
          [id, l.quadra, l.numero, l.areaM2, l.frenteM, l.fundoM, l.preco ?? null, l.status ?? null, JSON.stringify({ type: 'Polygon', coordinates: [anel] })],
        );
      }
      // o empreendimento sem localização ganha o centro do loteamento (a cidade e o relevo em volta passam a vir)
      const todos = leitura.lotes.flatMap((l) => l.contorno);
      const lon = todos.reduce((a, p) => a + p[0], 0) / todos.length;
      const lat = todos.reduce((a, p) => a + p[1], 0) / todos.length;
      await c.query('UPDATE projects p SET geom = ST_SetSRID(ST_MakePoint($1, $2), 4326) FROM buildings b WHERE b.id = $3 AND p.id = b.project_id AND p.geom IS NULL', [lon, lat, id]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'lotes.importar', entidade: 'building', entidadeId: id, depois: { lotes: leitura.lotes.length, formato: d.formato } });
      return { ...previa, aplicado: true };
    });
  });

  app.get('/predios/:id/lotes', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      return { lotes: await lotesDoPredio(c, id) };
    });
  });

  /** Preço (só a gestão) e situação (as mesmas regras das unidades: a consultora reserva e cancela a reserva). */
  app.patch('/lotes/:id', async (req) => {
    const s = await exigir(req, 'unidade:status');
    const { id } = IdParam.parse(req.params);
    const d = EdicaoLote.parse(req.body);
    if (d.preco !== undefined && !ehGestao(s.papel)) throw new ErroHttp(403, 'sem_permissao');
    return withTenant(pool, ctx(s), async (c) => {
      const atual = (await c.query<{ status: StatusUnidade; preco: number | null }>('SELECT status, preco::float8 AS preco FROM lotes WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!atual) throw new ErroHttp(404, 'nao_encontrado');
      if (d.status !== undefined && d.status !== atual.status) {
        const v = validarTransicao(s.papel, atual.status, d.status, d.motivo);
        if (!v.ok) throw new ErroHttp(v.erro === 'sem_permissao' ? 403 : 422, v.erro);
      }
      await c.query('UPDATE lotes SET status = coalesce($2, status), preco = CASE WHEN $3 THEN $4 ELSE preco END, atualizado_em = now() WHERE id = $1', [id, d.status ?? null, d.preco !== undefined, d.preco ?? null]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'lote.editar', entidade: 'lote', entidadeId: id, antes: atual, depois: { status: d.status, preco: d.preco, motivo: d.motivo } });
      return { ok: true };
    });
  });
}
