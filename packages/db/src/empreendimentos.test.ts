import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { withTenant } from './tenant';
import { resetarBanco } from './testing';

// Banco próprio deste arquivo: os arquivos de teste rodam em paralelo.
const OWNER = process.env.TEST_DATABASE_URL_OWNER_2 ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_2';
const APP = process.env.TEST_DATABASE_URL_2 ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_2';

let owner: pg.Pool;
let app: pg.Pool;
let A: string;
let B: string;
let projA: string;
let projB: string;

beforeAll(async () => {
  await resetarBanco(OWNER);
  owner = new pg.Pool({ connectionString: OWNER });
  app = new pg.Pool({ connectionString: APP });
  const t = await owner.query<{ id: string; slug: string }>(
    "INSERT INTO tenants (nome, slug) VALUES ('Empresa A', 'empresa-a'), ('Empresa B', 'empresa-b') RETURNING id, slug",
  );
  A = t.rows.find((r) => r.slug === 'empresa-a')!.id;
  B = t.rows.find((r) => r.slug === 'empresa-b')!.id;
  projA = (await owner.query<{ id: string }>("INSERT INTO projects (tenant_id, nome) VALUES ($1, 'Projeto A') RETURNING id", [A])).rows[0]!.id;
  projB = (await owner.query<{ id: string }>("INSERT INTO projects (tenant_id, nome) VALUES ($1, 'Projeto B') RETURNING id", [B])).rows[0]!.id;
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

const comoA = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(app, { tenantId: A, userId: null }, fn);
const comoB = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(app, { tenantId: B, userId: null }, fn);

describe('empreendimentos no banco', () => {
  let predioA = '';
  let andarA = '';

  it('cria prédio, andar, tipologia e unidade na própria empresa', async () => {
    await comoA(async (c) => {
      predioA = (await c.query<{ id: string }>("INSERT INTO buildings (project_id, nome) VALUES ($1, 'Torre A') RETURNING id", [projA])).rows[0]!.id;
      andarA = (await c.query<{ id: string }>("INSERT INTO floors (building_id, numero, nome) VALUES ($1, 1, '1º andar') RETURNING id", [predioA])).rows[0]!.id;
      const tipo = (await c.query<{ id: string }>("INSERT INTO unit_types (project_id, nome, area_m2, quartos) VALUES ($1, 'Tipo 2Q', 72.5, 2) RETURNING id", [projA])).rows[0]!.id;
      await c.query("INSERT INTO units (building_id, floor_id, unit_type_id, codigo, preco) VALUES ($1, $2, $3, '101', 650000)", [predioA, andarA, tipo]);
    });
    expect(await comoA(async (c) => (await c.query('SELECT * FROM units')).rowCount)).toBe(1);
    expect(await comoB(async (c) => (await c.query('SELECT * FROM units')).rowCount)).toBe(0);
  });

  it('BLINDAGEM: empresa A não consegue pendurar prédio no projeto da empresa B (mesmo sabendo o UUID)', async () => {
    await expect(comoA((c) => c.query("INSERT INTO buildings (project_id, nome) VALUES ($1, 'Invasão')", [projB]))).rejects.toThrow(/foreign key/);
  });

  it('BLINDAGEM: unidade não pode usar andar de outro prédio', async () => {
    const outroPredio = await comoA(async (c) => (await c.query<{ id: string }>("INSERT INTO buildings (project_id, nome) VALUES ($1, 'Torre B') RETURNING id", [projA])).rows[0]!.id);
    await expect(comoA((c) => c.query("INSERT INTO units (building_id, floor_id, codigo) VALUES ($1, $2, '999')", [outroPredio, andarA]))).rejects.toThrow(/foreign key/);
  });

  it('código da unidade é único por prédio e status só aceita valores válidos', async () => {
    await expect(comoA((c) => c.query("INSERT INTO units (building_id, floor_id, codigo) VALUES ($1, $2, '101')", [predioA, andarA]))).rejects.toThrow(/duplicate key/);
    await expect(comoA((c) => c.query("UPDATE units SET status = 'alugado'"))).rejects.toThrow(/check constraint/);
  });

  it('atualizado_em muda sozinho a cada alteração', async () => {
    const antes = await comoA(async (c) => (await c.query<{ atualizado_em: Date }>('SELECT atualizado_em FROM units')).rows[0]!.atualizado_em);
    await new Promise((r) => setTimeout(r, 20));
    const depois = await comoA(async (c) => (await c.query<{ atualizado_em: Date }>("UPDATE units SET preco = 660000 RETURNING atualizado_em")).rows[0]!.atualizado_em);
    expect(depois.getTime()).toBeGreaterThan(antes.getTime());
  });

  it('localização: guarda ponto PostGIS e devolve lat/lon', async () => {
    const r = await comoA(async (c) =>
      (await c.query<{ lat: number; lon: number }>(
        'UPDATE projects SET geom = ST_SetSRID(ST_MakePoint($2, $3), 4326) WHERE id = $1 RETURNING ST_Y(geom) AS lat, ST_X(geom) AS lon',
        [projA, -46.6545, -23.56175],
      )).rows[0]!,
    );
    expect(r).toEqual({ lat: -23.56175, lon: -46.6545 });
  });

  it('histórico e eventos: só inserção e leitura (sem apagar)', async () => {
    await comoA(async (c) => {
      const u = (await c.query<{ id: string }>('SELECT id FROM units')).rows[0]!.id;
      await c.query("INSERT INTO unit_status_history (unit_id, de, para) VALUES ($1, 'disponivel', 'reservado')", [u]);
      await c.query("INSERT INTO eventos (tipo, entidade_id) VALUES ('unidade.status_alterado', $1)", [u]);
    });
    await expect(comoA((c) => c.query('DELETE FROM unit_status_history'))).rejects.toThrow(/permission denied/);
    await expect(comoA((c) => c.query('DELETE FROM eventos'))).rejects.toThrow(/permission denied/);
    expect(await comoB(async (c) => (await c.query('SELECT * FROM eventos')).rowCount)).toBe(0);
  });

  it('modo simular desfaz tudo no fim', async () => {
    await withTenant(app, { tenantId: A, userId: null }, (c) => c.query("INSERT INTO buildings (project_id, nome) VALUES ($1, 'Simulado')", [projA]), { simular: true });
    expect(await comoA(async (c) => (await c.query("SELECT * FROM buildings WHERE nome = 'Simulado'")).rowCount)).toBe(0);
  });
});
