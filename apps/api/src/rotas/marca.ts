import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
}

/** Fontes seguras (Google Fonts curadas, grátis, ou do sistema): Plano 12b, item 11. */
export const FONTES_MARCA = ['sistema', 'inter', 'poppins', 'roboto', 'merriweather'] as const;
const CorHex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'cor no formato #RRGGBB');
const Marca = z.object({
  logoAssetId: z.uuid().nullable().optional(),
  corPrimaria: CorHex.nullable().optional(),
  fonte: z.enum(FONTES_MARCA).optional(),
});
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });

export interface MarcaTenant {
  logoAssetId: string | null;
  corPrimaria: string | null;
  fonte: (typeof FONTES_MARCA)[number];
}

/** Marca da incorporadora (logo, cor e fonte): aplicada no portal, no estande e na Vitrine (Plano 12b, item 11). */
export function rotasMarca(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  app.get('/empresa/marca', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    return withTenant(pool, ctx(s), async (c) => {
      const r = (await c.query<MarcaTenant>('SELECT logo_asset_id AS "logoAssetId", cor_primaria AS "corPrimaria", fonte FROM tenants WHERE id = $1', [s.tenantId])).rows[0];
      if (!r) throw new ErroHttp(404, 'nao_encontrado');
      return r;
    });
  });

  app.patch('/empresa/marca', async (req) => {
    const s = await exigir(req, 'marca:editar');
    const d = Marca.parse(req.body);
    return withTenant(pool, ctx(s), async (c) => {
      // o logo precisa ser uma foto já pronta desta empresa (a RLS de "assets" já restringe ao tenant da sessão)
      if (d.logoAssetId && !(await c.query("SELECT 1 FROM assets WHERE id = $1 AND status = 'pronto' AND tipo = 'imagem'", [d.logoAssetId])).rowCount) {
        throw new ErroHttp(400, 'arquivo_invalido');
      }
      const campos: Array<[string, unknown]> = [];
      if (d.logoAssetId !== undefined) campos.push(['logo_asset_id', d.logoAssetId]);
      if (d.corPrimaria !== undefined) campos.push(['cor_primaria', d.corPrimaria]);
      if (d.fonte !== undefined) campos.push(['fonte', d.fonte]);
      if (!campos.length) throw new ErroHttp(400, 'nada_para_mudar');
      const r = await c.query<MarcaTenant>(
        `UPDATE tenants SET ${campos.map(([k], i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1
         RETURNING logo_asset_id AS "logoAssetId", cor_primaria AS "corPrimaria", fonte`,
        [s.tenantId, ...campos.map(([, v]) => v)],
      );
      await registrarAuditoria(c, { userId: s.userId, acao: 'marca.editar', entidade: 'tenant', entidadeId: s.tenantId, depois: d });
      return r.rows[0]!;
    });
  });
}
