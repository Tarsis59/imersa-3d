import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';
import { transicoesPermitidas, validarTransicao, type StatusUnidade } from '../dominio/status';
import { validarPlanilha } from '../dominio/planilha';
import { aplicarPlanilha, nomeDoAndar, registrarMudancaStatus, type Resumo } from '../importar';
import { AtualizarProjeto, AtualizarUnidade, IdParam, Importacao, MudarStatus, NovaTipologia, NovaUnidade, NovoPredio } from '../esquemas';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
}

const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });
const ehViolacaoUnica = (e: unknown) => (e as { code?: string }).code === '23505';

class ImportacaoRecusada extends Error {
  constructor(readonly resultado: { resumo: Resumo; erros: unknown[] }) {
    super('importacao_recusada');
  }
}

/** 404 quando o registro não existe OU é de outra empresa (o RLS esconde): não revela existência. */
async function exigirLinha<T extends pg.QueryResultRow>(c: pg.PoolClient, sql: string, params: unknown[]): Promise<T> {
  const r = await c.query<T>(sql, params);
  if (!r.rows[0]) throw new ErroHttp(404, 'nao_encontrado');
  return r.rows[0];
}

export function rotasEmpreendimentos(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  app.get('/projetos/:id', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const projeto = await exigirLinha(
        c,
        `SELECT id, nome, descricao, endereco, cidade, uf, ST_Y(geom) AS lat, ST_X(geom) AS lon,
                altitude_m::float8 AS "altitudeM", rotacao_graus::float8 AS "rotacaoGraus", status
           FROM projects WHERE id = $1`,
        [id],
      );
      const predios = (
        await c.query(
          `SELECT b.id, b.nome,
                  (SELECT count(*)::int FROM floors f WHERE f.building_id = b.id) AS andares,
                  (SELECT count(*)::int FROM units u WHERE u.building_id = b.id) AS unidades
             FROM buildings b WHERE b.project_id = $1 ORDER BY b.nome`,
          [id],
        )
      ).rows;
      const tipologias = (
        await c.query('SELECT id, nome, area_m2::float8 AS "areaM2", quartos, suites, vagas FROM unit_types WHERE project_id = $1 ORDER BY nome', [id])
      ).rows;
      const contagem = (
        await c.query<{ status: StatusUnidade; n: number }>(
          'SELECT u.status, count(*)::int AS n FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.project_id = $1 GROUP BY u.status',
          [id],
        )
      ).rows;
      const resumo = { disponivel: 0, reservado: 0, vendido: 0, bloqueado: 0, total: 0 };
      for (const r of contagem) {
        resumo[r.status] = r.n;
        resumo.total += r.n;
      }
      return { projeto, predios, tipologias, resumo };
    });
  });

  app.patch('/projetos/:id', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = AtualizarProjeto.parse(req.body);
    const colunas: Record<string, unknown> = {
      nome: d.nome,
      descricao: d.descricao,
      endereco: d.endereco,
      cidade: d.cidade,
      uf: d.uf,
      altitude_m: d.altitudeM,
      rotacao_graus: d.rotacaoGraus,
      status: d.status,
    };
    const sets: string[] = [];
    const valores: unknown[] = [id];
    for (const [coluna, valor] of Object.entries(colunas)) {
      if (valor === undefined) continue;
      valores.push(valor);
      sets.push(`${coluna} = $${valores.length}`);
    }
    if (d.lat !== undefined && d.lon !== undefined) {
      valores.push(d.lon, d.lat);
      sets.push(`geom = ST_SetSRID(ST_MakePoint($${valores.length - 1}, $${valores.length}), 4326)`);
    }
    if (sets.length === 0) throw new ErroHttp(400, 'nada_para_alterar');
    return withTenant(pool, ctx(s), async (c) => {
      const r = await exigirLinha<{ id: string; nome: string }>(c, `UPDATE projects SET ${sets.join(', ')} WHERE id = $1 RETURNING id, nome`, valores);
      await registrarAuditoria(c, { userId: s.userId, acao: 'projeto.editar', entidade: 'project', entidadeId: id, depois: d });
      return r;
    });
  });

  app.post('/projetos/:id/predios', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = NovoPredio.parse(req.body);
    try {
      const predio = await withTenant(pool, ctx(s), async (c) => {
        await exigirLinha(c, 'SELECT id FROM projects WHERE id = $1', [id]);
        const p = (await c.query<{ id: string }>('INSERT INTO buildings (project_id, nome) VALUES ($1, $2) RETURNING id', [id, d.nome])).rows[0]!;
        const numeros = [...(d.incluirTerreo ? [0] : []), ...Array.from({ length: d.andares }, (_, i) => i + 1)];
        for (const n of numeros) await c.query('INSERT INTO floors (building_id, numero, nome) VALUES ($1, $2, $3)', [p.id, n, nomeDoAndar(n)]);
        await registrarAuditoria(c, { userId: s.userId, acao: 'predio.criar', entidade: 'building', entidadeId: p.id, depois: d });
        return p;
      });
      return reply.status(201).send(predio);
    } catch (e) {
      if (ehViolacaoUnica(e)) throw new ErroHttp(409, 'ja_existe');
      throw e;
    }
  });

  app.post('/projetos/:id/tipologias', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = NovaTipologia.parse(req.body);
    try {
      const t = await withTenant(pool, ctx(s), async (c) => {
        await exigirLinha(c, 'SELECT id FROM projects WHERE id = $1', [id]);
        const r = (
          await c.query<{ id: string }>(
            'INSERT INTO unit_types (project_id, nome, area_m2, quartos, suites, vagas) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [id, d.nome, d.areaM2, d.quartos, d.suites, d.vagas],
          )
        ).rows[0]!;
        await registrarAuditoria(c, { userId: s.userId, acao: 'tipologia.criar', entidade: 'unit_type', entidadeId: r.id, depois: d });
        return r;
      });
      return reply.status(201).send(t);
    } catch (e) {
      if (ehViolacaoUnica(e)) throw new ErroHttp(409, 'ja_existe');
      throw e;
    }
  });

  app.get('/predios/:id', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      const predio = await exigirLinha(
        c,
        'SELECT b.id, b.nome, b.modelo_asset_id AS "modeloArquivoId", p.id AS "projetoId", p.nome AS "projetoNome" FROM buildings b JOIN projects p ON p.id = b.project_id WHERE b.id = $1',
        [id],
      );
      const andares = (await c.query<{ id: string; numero: number; nome: string }>('SELECT id, numero, nome FROM floors WHERE building_id = $1 ORDER BY numero DESC', [id])).rows;
      const unidades = (
        await c.query<{ id: string; floor_id: string; codigo: string; status: StatusUnidade; preco: number | null; tipologia: string | null; areaM2: number | null; quartos: number | null }>(
          `SELECT u.id, u.floor_id, u.codigo, u.status, u.preco::float8 AS preco, u.mesh_node_id AS "meshNodeId",
                  t.nome AS tipologia, t.area_m2::float8 AS "areaM2", t.quartos
             FROM units u LEFT JOIN unit_types t ON t.id = u.unit_type_id
            WHERE u.building_id = $1 ORDER BY u.codigo`,
          [id],
        )
      ).rows;
      return {
        predio,
        andares: andares.map((a) => ({
          ...a,
          unidades: unidades
            .filter((u) => u.floor_id === a.id)
            .map(({ floor_id: _andar, ...u }) => ({ ...u, transicoes: transicoesPermitidas(s.papel, u.status) })),
        })),
      };
    });
  });

  app.post('/predios/:id/unidades', async (req, reply) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = NovaUnidade.parse(req.body);
    try {
      const u = await withTenant(pool, ctx(s), async (c) => {
        const predio = await exigirLinha<{ project_id: string }>(c, 'SELECT project_id FROM buildings WHERE id = $1', [id]);
        const andar = (await c.query<{ id: string }>('SELECT id FROM floors WHERE building_id = $1 AND numero = $2', [id, d.andar])).rows[0];
        if (!andar) throw new ErroHttp(400, 'andar_inexistente');
        if (d.tipologiaId) await exigirTipologiaDoProjeto(c, d.tipologiaId, predio.project_id);
        const r = (
          await c.query<{ id: string }>(
            'INSERT INTO units (building_id, floor_id, unit_type_id, codigo, preco) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [id, andar.id, d.tipologiaId ?? null, d.codigo, d.preco ?? null],
          )
        ).rows[0]!;
        await registrarAuditoria(c, { userId: s.userId, acao: 'unidade.criar', entidade: 'unit', entidadeId: r.id, depois: d });
        return r;
      });
      return reply.status(201).send(u);
    } catch (e) {
      if (ehViolacaoUnica(e)) throw new ErroHttp(409, 'ja_existe');
      throw e;
    }
  });

  app.patch('/unidades/:id', async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const d = AtualizarUnidade.parse(req.body);
    const sets: string[] = [];
    const valores: unknown[] = [id];
    const por = (coluna: string, valor: unknown) => {
      if (valor === undefined) return;
      valores.push(valor);
      sets.push(`${coluna} = $${valores.length}`);
    };
    por('preco', d.preco);
    por('unit_type_id', d.tipologiaId);
    por('mesh_node_id', d.meshNodeId);
    if (sets.length === 0) throw new ErroHttp(400, 'nada_para_alterar');
    return withTenant(pool, ctx(s), async (c) => {
      const atual = await exigirLinha<{ project_id: string }>(
        c,
        'SELECT b.project_id FROM units u JOIN buildings b ON b.id = u.building_id WHERE u.id = $1 FOR UPDATE OF u',
        [id],
      );
      if (d.tipologiaId) await exigirTipologiaDoProjeto(c, d.tipologiaId, atual.project_id);
      if (d.meshNodeId) {
        const ocupado = await c.query(
          'SELECT 1 FROM units WHERE mesh_node_id = $2 AND id <> $1 AND building_id = (SELECT building_id FROM units WHERE id = $1)',
          [id, d.meshNodeId],
        );
        if (ocupado.rowCount) throw new ErroHttp(409, 'no_3d_em_uso');
      }
      const r = (
        await c.query(`UPDATE units SET ${sets.join(', ')} WHERE id = $1 RETURNING id, codigo, status, preco::float8 AS preco, unit_type_id AS "tipologiaId", mesh_node_id AS "meshNodeId"`, valores)
      ).rows[0];
      await registrarAuditoria(c, { userId: s.userId, acao: 'unidade.editar', entidade: 'unit', entidadeId: id, depois: d });
      return r;
    });
  });

  app.post('/unidades/:id/status', async (req) => {
    const s = await exigir(req, 'unidade:status');
    const { id } = IdParam.parse(req.params);
    const d = MudarStatus.parse(req.body);
    return withTenant(pool, ctx(s), async (c) => {
      const atual = await exigirLinha<{ status: StatusUnidade }>(c, 'SELECT status FROM units WHERE id = $1 FOR UPDATE', [id]);
      const v = validarTransicao(s.papel, atual.status, d.status, d.motivo);
      if (!v.ok) {
        const http = { transicao_invalida: 409, sem_permissao: 403, motivo_obrigatorio: 400 } as const;
        throw new ErroHttp(http[v.erro], v.erro);
      }
      await c.query('UPDATE units SET status = $2 WHERE id = $1', [id, d.status]);
      await registrarMudancaStatus(c, id, atual.status, d.status, s.userId, d.motivo?.trim() || null);
      await registrarAuditoria(c, { userId: s.userId, acao: 'unidade.status', entidade: 'unit', entidadeId: id, antes: { status: atual.status }, depois: { status: d.status, motivo: d.motivo } });
      return { id, status: d.status, transicoes: transicoesPermitidas(s.papel, d.status) };
    });
  });

  app.get('/unidades/:id/historico', async (req) => {
    const s = await exigir(req, 'projeto:ler');
    const { id } = IdParam.parse(req.params);
    return withTenant(pool, ctx(s), async (c) => {
      await exigirLinha(c, 'SELECT id FROM units WHERE id = $1', [id]);
      return (
        await c.query(
          `SELECT h.de, h.para, h.motivo, h.criado_em AS "criadoEm", u.nome AS usuario
             FROM unit_status_history h LEFT JOIN users u ON u.id = h.user_id
            WHERE h.unit_id = $1 ORDER BY h.id DESC LIMIT 100`,
          [id],
        )
      ).rows;
    });
  });

  app.post('/projetos/:id/importacao', { bodyLimit: 3_000_000 }, async (req, reply) => {
    const s = await exigir(req, 'importacao:executar');
    const { id } = IdParam.parse(req.params);
    const d = Importacao.parse(req.body);
    const validacao = validarPlanilha(d.csv);
    if (validacao.erros.length) return reply.status(d.aplicar ? 400 : 200).send({ aplicado: false, resumo: null, erros: validacao.erros });
    try {
      const r = await withTenant(
        pool,
        ctx(s),
        async (c) => {
          await exigirLinha(c, 'SELECT id FROM projects WHERE id = $1', [id]);
          const resultado = await aplicarPlanilha(c, id, validacao.linhas, s);
          if (d.aplicar && resultado.erros.length) throw new ImportacaoRecusada(resultado);
          if (d.aplicar) {
            await registrarAuditoria(c, { userId: s.userId, acao: 'importacao.aplicar', entidade: 'project', entidadeId: id, depois: resultado.resumo });
          }
          return resultado;
        },
        { simular: !d.aplicar },
      );
      return { aplicado: d.aplicar, resumo: r.resumo, erros: r.erros };
    } catch (e) {
      if (e instanceof ImportacaoRecusada) return reply.status(400).send({ aplicado: false, ...e.resultado });
      throw e;
    }
  });
}

async function exigirTipologiaDoProjeto(c: pg.PoolClient, tipologiaId: string, projetoId: string): Promise<void> {
  const t = (await c.query<{ project_id: string }>('SELECT project_id FROM unit_types WHERE id = $1', [tipologiaId])).rows[0];
  if (!t) throw new ErroHttp(400, 'tipologia_inexistente');
  if (t.project_id !== projetoId) throw new ErroHttp(400, 'tipologia_de_outro_empreendimento');
}
