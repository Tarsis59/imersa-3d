import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { withTenant } from './tenant';
import { resetarBanco } from './testing';

// Banco próprio deste arquivo: os arquivos de teste rodam em paralelo.
const OWNER = process.env.TEST_DATABASE_URL_OWNER_3 ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test_3';
const APP = process.env.TEST_DATABASE_URL_3 ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test_3';

let owner: pg.Pool;
let app: pg.Pool;
let A: string;
let B: string;
let projA: string;
let projB: string;
let predioA: string;
let andarA: string;

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
  predioA = (await owner.query<{ id: string }>("INSERT INTO buildings (tenant_id, project_id, nome) VALUES ($1, $2, 'Torre A') RETURNING id", [A, projA])).rows[0]!.id;
  andarA = (await owner.query<{ id: string }>("INSERT INTO floors (tenant_id, building_id, numero, nome) VALUES ($1, $2, 1, '1º andar') RETURNING id", [A, predioA])).rows[0]!.id;
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

const comoA = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(app, { tenantId: A, userId: null }, fn);
const comoB = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(app, { tenantId: B, userId: null }, fn);

const novoArquivo = (c: pg.PoolClient, projeto: string, chave: string) =>
  c
    .query<{ id: string }>("INSERT INTO assets (project_id, tipo, nome, chave, tamanho_declarado) VALUES ($1, 'modelo_3d', 'casa.glb', $2, 1000) RETURNING id", [projeto, chave])
    .then((r) => r.rows[0]!.id);

describe('arquivos e pontos de interesse no banco', () => {
  let arquivoA = '';

  it('arquivo nasce aguardando envio e só a própria empresa vê', async () => {
    arquivoA = await comoA((c) => novoArquivo(c, projA, 'a/casa.glb'));
    expect(await comoA(async (c) => (await c.query('SELECT status, verificado_antivirus FROM assets')).rows)).toEqual([
      { status: 'aguardando_envio', verificado_antivirus: false },
    ]);
    expect(await comoB(async (c) => (await c.query('SELECT * FROM assets')).rowCount)).toBe(0);
  });

  it('BLINDAGEM: não cria arquivo no projeto de outra empresa', async () => {
    await expect(comoA((c) => novoArquivo(c, projB, 'x/invasao.glb'))).rejects.toThrow(/foreign key/);
  });

  it('BLINDAGEM: arquivo de outra empresa não vira modelo do prédio', async () => {
    const arquivoB = await comoB((c) => novoArquivo(c, projB, 'b/casa.glb'));
    await expect(comoA((c) => c.query('UPDATE buildings SET modelo_asset_id = $2 WHERE id = $1', [predioA, arquivoB]))).rejects.toThrow(/foreign key/);
  });

  it('apagar o arquivo desvincula o modelo do prédio (sem apagar o prédio)', async () => {
    await comoA((c) => c.query('UPDATE buildings SET modelo_asset_id = $2 WHERE id = $1', [predioA, arquivoA]));
    await comoA((c) => c.query('DELETE FROM assets WHERE id = $1', [arquivoA]));
    const p = await comoA(async (c) => (await c.query<{ modelo_asset_id: string | null; tenant_id: string }>('SELECT modelo_asset_id, tenant_id FROM buildings WHERE id = $1', [predioA])).rows[0]!);
    expect(p).toEqual({ modelo_asset_id: null, tenant_id: A });
  });

  it('o mesmo nó do modelo 3D não pode ser de duas unidades do mesmo prédio', async () => {
    await comoA((c) => c.query("INSERT INTO units (building_id, floor_id, codigo, mesh_node_id) VALUES ($1, $2, '101', 'no-1')", [predioA, andarA]));
    await expect(comoA((c) => c.query("INSERT INTO units (building_id, floor_id, codigo, mesh_node_id) VALUES ($1, $2, '102', 'no-1')", [predioA, andarA]))).rejects.toThrow(
      /duplicate key/,
    );
    await comoA((c) => c.query("INSERT INTO units (building_id, floor_id, codigo) VALUES ($1, $2, '103'), ($1, $2, '104')", [predioA, andarA]));
  });

  it('pontos de interesse: isolados por empresa, sem duplicar o mesmo do OSM, e com distância em metros', async () => {
    await comoA((c) => c.query('UPDATE projects SET geom = ST_SetSRID(ST_MakePoint(-46.6545, -23.56175), 4326) WHERE id = $1', [projA]));
    const inserir = (c: pg.PoolClient) =>
      c.query(
        "INSERT INTO pois (project_id, categoria, nome, geom, origem, osm_id) VALUES ($1, 'transporte', 'Estação Trianon-MASP', ST_SetSRID(ST_MakePoint(-46.6564, -23.5614), 4326), 'osm', 'node/1')",
        [projA],
      );
    await comoA(inserir);
    await expect(comoA(inserir)).rejects.toThrow(/duplicate key/);
    const d = await comoA(
      async (c) =>
        (
          await c.query<{ m: number }>(
            'SELECT ST_Distance(p.geom::geography, pr.geom::geography) AS m FROM pois p JOIN projects pr ON pr.id = p.project_id',
          )
        ).rows[0]!.m,
    );
    expect(d).toBeGreaterThan(150);
    expect(d).toBeLessThan(300);
    expect(await comoB(async (c) => (await c.query('SELECT * FROM pois')).rowCount)).toBe(0);
  });
});
