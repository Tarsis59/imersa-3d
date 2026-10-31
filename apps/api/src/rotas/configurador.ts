import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import { ehGestao, type Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';
import { calcularOrcamento, type MaterialPreco, type MovelPreco } from '../dominio/orcamento';
import { LICENCA_MOVEIS_PADRAO, MATERIAIS_INICIAIS, MOVEIS_INICIAIS } from '../dominio/catalogo-inicial';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
}

const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });
const CATEGORIAS_MATERIAL = ['piso', 'parede', 'teto', 'telhado', 'esquadria', 'bancada', 'outro'] as const;
const PADROES = ['liso', 'madeira', 'porcelanato', 'marmore', 'cimento', 'tijolo', 'pastilha'] as const;
const CATEGORIAS_MOVEL = ['sala', 'quarto', 'cozinha', 'banheiro', 'escritorio', 'externo', 'decoracao'] as const;
const cor = z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((c) => c.toLowerCase());
const preco = z.number().min(0).max(1e9).multipleOf(0.01).nullable();
const textoOpcional = (max: number) => z.string().trim().max(max).transform((t) => t || null).nullable().optional();

const CamposMaterial = z.object({
  nome: z.string().trim().min(2).max(120),
  categoria: z.enum(CATEGORIAS_MATERIAL),
  padrao: z.enum(PADROES),
  cor,
  cor2: cor.nullable().optional(),
  rugosidade: z.number().min(0).max(1),
  metalico: z.number().min(0).max(1),
  escalaM: z.number().min(0.05).max(5),
  precoM2: preco.optional(),
  fornecedor: textoOpcional(120),
  codigo: textoOpcional(60),
});
// padrões só na criação: na alteração, campo ausente = não mexe
const NovoMaterial = CamposMaterial.extend({
  padrao: CamposMaterial.shape.padrao.default('liso'),
  rugosidade: CamposMaterial.shape.rugosidade.default(0.8),
  metalico: CamposMaterial.shape.metalico.default(0),
  escalaM: CamposMaterial.shape.escalaM.default(0.6),
});
const MudarMaterial = CamposMaterial.partial().extend({ ativo: z.boolean().optional() });

const CamposMovel = z.object({
  nome: z.string().trim().min(2).max(120),
  categoria: z.enum(CATEGORIAS_MOVEL),
  preco: preco.optional(),
  licenca: z.string().trim().min(2).max(120),
  autor: z.string().trim().min(2).max(120),
  fonteUrl: z.url({ protocol: /^https$/ }).max(500).nullable().optional(),
});
/** Móvel do catálogo: um dos padrões do visualizador ou um GLB já verificado em "Arquivos". */
const NovoMovel = CamposMovel.extend({ modeloPadrao: z.string().optional(), arquivoId: z.uuid().optional() }).refine((m) => !!m.modeloPadrao !== !!m.arquivoId, {
  message: 'escolha um modelo padrão OU um arquivo',
});
const MudarMovel = CamposMovel.partial().extend({ ativo: z.boolean().optional() });
const Filtro = z.object({ todos: z.enum(['0', '1']).default('0') });

const Pose = z.object({ x: z.number().min(-10_000).max(10_000), y: z.number().min(-1_000).max(10_000), z: z.number().min(-10_000).max(10_000), giroGraus: z.number().min(0).max(359) });
const Configuracao = z.object({
  nome: z.string().trim().min(2).max(120),
  cliente: textoOpcional(120),
  unidadeId: z.uuid().nullable().optional(),
  superficies: z
    .array(z.object({ chave: z.string().min(1).max(200), rotulo: z.string().trim().min(1).max(200), areaM2: z.number().min(0).max(1_000_000), materialId: z.uuid().nullable() }))
    .max(200),
  moveis: z.array(z.object({ instanciaId: z.string().regex(/^[\w-]{1,40}$/), movelId: z.uuid(), pose: Pose })).max(300),
});
type DadosConfiguracao = z.infer<typeof Configuracao>;

const COLUNAS_MATERIAL = `id, nome, categoria, padrao, cor, cor2, rugosidade::float8 AS rugosidade, metalico::float8 AS metalico,
  escala_m::float8 AS "escalaM", preco_m2::float8 AS "precoM2", fornecedor, codigo, ativo`;
const COLUNAS_MOVEL = `m.id, m.nome, m.categoria, m.modelo_padrao AS "modeloPadrao", m.asset_id AS "arquivoId", a.nome AS "arquivoNome",
  m.preco::float8 AS preco, m.licenca, m.autor, m.fonte_url AS "fonteUrl", m.ativo`;

const unico = (e: unknown) => (e as { code?: string }).code === '23505';

export function rotasConfigurador(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  // ------------------------------------------------------------------ materiais
  app.get('/materiais', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { todos } = Filtro.parse(req.query);
    return withTenant(pool, ctx(s), async (c) =>
      (await c.query(`SELECT ${COLUNAS_MATERIAL} FROM materiais WHERE ($1 OR ativo) ORDER BY categoria, nome`, [todos === '1' && ehGestao(s.papel)])).rows,
    );
  });

  app.post('/materiais', async (req, reply) => {
    const s = await exigir(req, 'catalogo:editar');
    const d = NovoMaterial.parse(req.body);
    const criado = await withTenant(pool, ctx(s), async (c) => {
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO materiais (nome, categoria, padrao, cor, cor2, rugosidade, metalico, escala_m, preco_m2, fornecedor, codigo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [d.nome, d.categoria, d.padrao, d.cor, d.cor2 ?? null, d.rugosidade, d.metalico, d.escalaM, d.precoM2 ?? null, d.fornecedor ?? null, d.codigo ?? null],
        );
        await registrarAuditoria(c, { userId: s.userId, acao: 'material.criar', entidade: 'material', entidadeId: r.rows[0]!.id, depois: d });
        return r.rows[0]!;
      } catch (e) {
        if (unico(e)) throw new ErroHttp(409, 'ja_existe');
        throw e;
      }
    });
    return reply.status(201).send(criado);
  });

  app.patch('/materiais/:id', async (req) => {
    const s = await exigir(req, 'catalogo:editar');
    const { id } = IdParam.parse(req.params);
    const d = MudarMaterial.parse(req.body);
    const mapa: Record<string, string> = { nome: 'nome', categoria: 'categoria', padrao: 'padrao', cor: 'cor', cor2: 'cor2', rugosidade: 'rugosidade', metalico: 'metalico', escalaM: 'escala_m', precoM2: 'preco_m2', fornecedor: 'fornecedor', codigo: 'codigo', ativo: 'ativo' };
    const campos = Object.entries(d).filter(([, v]) => v !== undefined);
    if (!campos.length) throw new ErroHttp(400, 'nada_para_alterar');
    return withTenant(pool, ctx(s), async (c) => {
      const antes = (await c.query(`SELECT ${COLUNAS_MATERIAL} FROM materiais WHERE id = $1`, [id])).rows[0];
      if (!antes) throw new ErroHttp(404, 'nao_encontrado');
      try {
        const r = await c.query(`UPDATE materiais SET ${campos.map(([k], i) => `${mapa[k]} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING ${COLUNAS_MATERIAL}`, [id, ...campos.map(([, v]) => v)]);
        await registrarAuditoria(c, { userId: s.userId, acao: 'material.alterar', entidade: 'material', entidadeId: id, antes, depois: d });
        return r.rows[0];
      } catch (e) {
        if (unico(e)) throw new ErroHttp(409, 'ja_existe');
        throw e;
      }
    });
  });

  /** Acabamentos comuns para começar (sem preço: o preço é da construtora). Rodar de novo não duplica. */
  app.post('/materiais/catalogo-inicial', async (req) => {
    const s = await exigir(req, 'catalogo:editar');
    return withTenant(pool, ctx(s), async (c) => {
      let criados = 0;
      for (const m of MATERIAIS_INICIAIS) {
        const r = await c.query(
          `INSERT INTO materiais (nome, categoria, padrao, cor, cor2, rugosidade, metalico, escala_m) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tenant_id, nome) DO NOTHING`,
          [m.nome, m.categoria, m.padrao, m.cor, m.cor2 ?? null, m.rugosidade, m.metalico ?? 0, m.escalaM],
        );
        criados += r.rowCount ?? 0;
      }
      let moveis = 0;
      for (const m of MOVEIS_INICIAIS) {
        const r = await c.query(
          `INSERT INTO moveis (nome, categoria, modelo_padrao, licenca, autor) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, nome) DO NOTHING`,
          [m.nome, m.categoria, m.chave, LICENCA_MOVEIS_PADRAO.licenca, LICENCA_MOVEIS_PADRAO.autor],
        );
        moveis += r.rowCount ?? 0;
      }
      await registrarAuditoria(c, { userId: s.userId, acao: 'catalogo.inicial', entidade: 'tenant', entidadeId: s.tenantId, depois: { materiais: criados, moveis } });
      return { materiais: criados, moveis };
    });
  });

  // ------------------------------------------------------------------ móveis
  app.get('/moveis', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { todos } = Filtro.parse(req.query);
    return withTenant(pool, ctx(s), async (c) =>
      (await c.query(`SELECT ${COLUNAS_MOVEL} FROM moveis m LEFT JOIN assets a ON a.id = m.asset_id WHERE ($1 OR m.ativo) ORDER BY m.categoria, m.nome`, [todos === '1' && ehGestao(s.papel)])).rows,
    );
  });

  app.post('/moveis', async (req, reply) => {
    const s = await exigir(req, 'catalogo:editar');
    const d = NovoMovel.parse(req.body);
    if (d.modeloPadrao && !MOVEIS_INICIAIS.some((m) => m.chave === d.modeloPadrao)) throw new ErroHttp(400, 'modelo_padrao_inexistente');
    const criado = await withTenant(pool, ctx(s), async (c) => {
      if (d.arquivoId) {
        const a = (await c.query<{ tipo: string; status: string }>('SELECT tipo, status FROM assets WHERE id = $1', [d.arquivoId])).rows[0];
        if (!a || a.tipo !== 'modelo_3d' || a.status !== 'pronto') throw new ErroHttp(400, 'arquivo_invalido_para_movel');
      }
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO moveis (nome, categoria, modelo_padrao, asset_id, preco, licenca, autor, fonte_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [d.nome, d.categoria, d.modeloPadrao ?? null, d.arquivoId ?? null, d.preco ?? null, d.licenca, d.autor, d.fonteUrl ?? null],
        );
        await registrarAuditoria(c, { userId: s.userId, acao: 'movel.criar', entidade: 'movel', entidadeId: r.rows[0]!.id, depois: d });
        return r.rows[0]!;
      } catch (e) {
        if (unico(e)) throw new ErroHttp(409, 'ja_existe');
        throw e;
      }
    });
    return reply.status(201).send(criado);
  });

  app.patch('/moveis/:id', async (req) => {
    const s = await exigir(req, 'catalogo:editar');
    const { id } = IdParam.parse(req.params);
    const d = MudarMovel.parse(req.body);
    const mapa: Record<string, string> = { nome: 'nome', categoria: 'categoria', preco: 'preco', licenca: 'licenca', autor: 'autor', fonteUrl: 'fonte_url', ativo: 'ativo' };
    const campos = Object.entries(d).filter(([, v]) => v !== undefined);
    if (!campos.length) throw new ErroHttp(400, 'nada_para_alterar');
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM moveis WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      try {
        await c.query(`UPDATE moveis SET ${campos.map(([k], i) => `${mapa[k]} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...campos.map(([, v]) => v)]);
        await registrarAuditoria(c, { userId: s.userId, acao: 'movel.alterar', entidade: 'movel', entidadeId: id, depois: d });
        return (await c.query(`SELECT ${COLUNAS_MOVEL} FROM moveis m LEFT JOIN assets a ON a.id = m.asset_id WHERE m.id = $1`, [id])).rows[0];
      } catch (e) {
        if (unico(e)) throw new ErroHttp(409, 'ja_existe');
        throw e;
      }
    });
  });

  // ------------------------------------------------------------------ combinações e orçamento
  /** Confere o que veio do 3D contra o catálogo da empresa e calcula o orçamento com os preços de agora. */
  async function montar(c: pg.PoolClient, predioId: string, d: DadosConfiguracao) {
    if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [predioId])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
    if (d.unidadeId && !(await c.query('SELECT 1 FROM units WHERE id = $1 AND building_id = $2', [d.unidadeId, predioId])).rowCount) throw new ErroHttp(400, 'unidade_de_outro_predio');
    if (new Set(d.superficies.map((x) => x.chave)).size !== d.superficies.length) throw new ErroHttp(400, 'superficie_repetida');
    if (new Set(d.moveis.map((x) => x.instanciaId)).size !== d.moveis.length) throw new ErroHttp(400, 'movel_repetido');
    const idsMat = [...new Set(d.superficies.flatMap((x) => (x.materialId ? [x.materialId] : [])))];
    const idsMov = [...new Set(d.moveis.map((x) => x.movelId))];
    // material/móvel desativado depois de escolhido ainda vale numa combinação que já o usava; novo, não
    const materiais = new Map(
      (await c.query<MaterialPreco>('SELECT id, nome, preco_m2::float8 AS "precoM2" FROM materiais WHERE id = ANY($1::uuid[])', [idsMat])).rows.map((m) => [m.id, m]),
    );
    const moveis = new Map((await c.query<MovelPreco>('SELECT id, nome, preco::float8 AS preco FROM moveis WHERE id = ANY($1::uuid[])', [idsMov])).rows.map((m) => [m.id, m]));
    if (materiais.size !== idsMat.length) throw new ErroHttp(400, 'material_inexistente');
    if (moveis.size !== idsMov.length) throw new ErroHttp(400, 'movel_inexistente');
    const orcamento = calcularOrcamento(d.superficies, d.moveis, materiais, moveis);
    return { escolhas: { superficies: d.superficies, moveis: d.moveis }, orcamento };
  }

  const COLUNAS_CONFIG = `c.id, c.nome, c.cliente, c.unit_id AS "unidadeId", u.codigo AS "unidadeCodigo", c.total::float8 AS total,
    c.criado_em AS "criadoEm", c.atualizado_em AS "atualizadoEm", json_build_object('id', p.id, 'nome', p.nome) AS "criadoPor"`;
  /** Consultora vê as combinações que ela montou; a gestão vê todas. */
  const soDela = (s: Sessao) => (ehGestao(s.papel) ? null : s.userId);

  app.get('/predios/:id/configuracoes', async (req) => {
    const s = await exigir(req, 'configuracao:salvar');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      return (
        await c.query(
          `SELECT ${COLUNAS_CONFIG} FROM configuracoes c LEFT JOIN units u ON u.id = c.unit_id LEFT JOIN users p ON p.id = c.criado_por
            WHERE c.building_id = $1 AND ($2::uuid IS NULL OR c.criado_por = $2) ORDER BY c.atualizado_em DESC`,
          [id, soDela(s)],
        )
      ).rows;
    });
  });

  app.post('/predios/:id/configuracoes', async (req, reply) => {
    const s = await exigir(req, 'configuracao:salvar');
    const { id } = IdParam.parse(req.params);
    const d = Configuracao.parse(req.body);
    const criada = await withTenant(pool, ctx(s), async (c) => {
      const m = await montar(c, id, d);
      const r = await c.query<{ id: string }>(
        'INSERT INTO configuracoes (building_id, unit_id, nome, cliente, escolhas, orcamento, total) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [id, d.unidadeId ?? null, d.nome, d.cliente ?? null, m.escolhas, m.orcamento, m.orcamento.total],
      );
      await registrarAuditoria(c, { userId: s.userId, acao: 'configuracao.criar', entidade: 'configuracao', entidadeId: r.rows[0]!.id, depois: { predio: id, total: m.orcamento.total } });
      return { id: r.rows[0]!.id, orcamento: m.orcamento };
    });
    return reply.status(201).send(criada);
  });

  async function carregar(c: pg.PoolClient, s: Sessao, id: string) {
    const r = (
      await c.query(
        `SELECT ${COLUNAS_CONFIG}, c.building_id AS "predioId", b.nome AS "predioNome", pr.nome AS "projetoNome", c.escolhas, c.orcamento
           FROM configuracoes c JOIN buildings b ON b.id = c.building_id JOIN projects pr ON pr.id = b.project_id
           LEFT JOIN units u ON u.id = c.unit_id LEFT JOIN users p ON p.id = c.criado_por
          WHERE c.id = $1 AND ($2::uuid IS NULL OR c.criado_por = $2)`,
        [id, soDela(s)],
      )
    ).rows[0];
    if (!r) throw new ErroHttp(404, 'nao_encontrado');
    return r;
  }

  app.get('/configuracoes/:id', async (req) => {
    const s = await exigir(req, 'configuracao:salvar');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), (c) => carregar(c, s, id));
  });

  app.put('/configuracoes/:id', async (req) => {
    const s = await exigir(req, 'configuracao:salvar');
    const { id } = IdParam.parse(req.params);
    const d = Configuracao.parse(req.body);
    return withTenant(pool, ctx(s), async (c) => {
      const atual = await carregar(c, s, id);
      const m = await montar(c, atual.predioId, d);
      await c.query('UPDATE configuracoes SET unit_id = $2, nome = $3, cliente = $4, escolhas = $5, orcamento = $6, total = $7 WHERE id = $1', [
        id,
        d.unidadeId ?? null,
        d.nome,
        d.cliente ?? null,
        m.escolhas,
        m.orcamento,
        m.orcamento.total,
      ]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'configuracao.alterar', entidade: 'configuracao', entidadeId: id, antes: { total: atual.total }, depois: { total: m.orcamento.total } });
      return { id, orcamento: m.orcamento };
    });
  });

  app.delete('/configuracoes/:id', async (req, reply) => {
    const s = await exigir(req, 'configuracao:salvar');
    const { id } = IdParam.parse(req.params);
    await withTenant(pool, ctx(s), async (c) => {
      await carregar(c, s, id);
      await c.query('DELETE FROM configuracoes WHERE id = $1', [id]);
      await registrarAuditoria(c, { userId: s.userId, acao: 'configuracao.apagar', entidade: 'configuracao', entidadeId: id });
    });
    return reply.status(204).send();
  });
}
