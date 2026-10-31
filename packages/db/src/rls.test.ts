import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { withTenant, type Contexto } from './tenant';
import { migrate } from './migrate';
import { resetarBanco } from './testing';

const OWNER = process.env.TEST_DATABASE_URL_OWNER ?? 'postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_test';
const APP = process.env.TEST_DATABASE_URL ?? 'postgres://imersa_app:imersa_app_dev@localhost:55432/imersa_test';

let owner: pg.Pool;
let app: pg.Pool;
let A: string;
let B: string;

beforeAll(async () => {
  await resetarBanco(OWNER);
  owner = new pg.Pool({ connectionString: OWNER });
  app = new pg.Pool({ connectionString: APP });
  const t = await owner.query<{ id: string; slug: string }>(
    "INSERT INTO tenants (nome, slug) VALUES ('Empresa A', 'empresa-a'), ('Empresa B', 'empresa-b') RETURNING id, slug",
  );
  A = t.rows.find((r) => r.slug === 'empresa-a')!.id;
  B = t.rows.find((r) => r.slug === 'empresa-b')!.id;
  await owner.query("INSERT INTO projects (tenant_id, nome) VALUES ($1, 'Projeto A'), ($2, 'Projeto B')", [A, B]);
  await owner.query(
    "INSERT INTO convites (tenant_id, email, papel, token_hash, expira_em) VALUES ($1, 'x@teste.com', 'consultora', 'hash-do-convite-a', now() + interval '7 days')",
    [A],
  );
});

afterAll(async () => {
  await owner.end();
  await app.end();
});

const nomes = (ctx: Contexto) =>
  withTenant(app, ctx, async (c) => (await c.query<{ nome: string }>('SELECT nome FROM projects ORDER BY nome')).rows.map((r) => r.nome));
const convites = (ctx: Contexto) => withTenant(app, ctx, async (c) => (await c.query('SELECT id FROM convites')).rowCount);

describe('RLS por empresa', () => {
  it('empresa A vê só os seus projetos', async () => {
    expect(await nomes({ tenantId: A, userId: null })).toEqual(['Projeto A']);
  });

  it('empresa B vê só os seus projetos', async () => {
    expect(await nomes({ tenantId: B, userId: null })).toEqual(['Projeto B']);
  });

  it('sem empresa definida não vê nada', async () => {
    expect(await nomes({ tenantId: null, userId: null })).toEqual([]);
    expect((await app.query('SELECT * FROM projects')).rowCount).toBe(0);
  });

  it('não consegue inserir em outra empresa', async () => {
    await expect(
      withTenant(app, { tenantId: A, userId: null }, (c) => c.query('INSERT INTO projects (tenant_id, nome) VALUES ($1, $2)', [B, 'Invasão'])),
    ).rejects.toThrow(/row-level security/);
  });

  it('não consegue alterar nem apagar dados de outra empresa', async () => {
    const r = await withTenant(app, { tenantId: A, userId: null }, async (c) => ({
      upd: (await c.query("UPDATE projects SET nome = 'hack' WHERE tenant_id = $1", [B])).rowCount,
      del: (await c.query('DELETE FROM projects WHERE tenant_id = $1', [B])).rowCount,
    }));
    expect(r).toEqual({ upd: 0, del: 0 });
    expect(await nomes({ tenantId: B, userId: null })).toEqual(['Projeto B']);
  });

  it('o contexto não vaza entre transações da mesma conexão', async () => {
    await nomes({ tenantId: A, userId: null });
    expect(await nomes({ tenantId: null, userId: null })).toEqual([]);
  });

  it('o papel da aplicação não é superusuário nem ignora RLS', async () => {
    const r = await owner.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'imersa_app'",
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('auditoria é somente inserção para a aplicação', async () => {
    await expect(withTenant(app, { tenantId: A, userId: null }, (c) => c.query('DELETE FROM audit_logs'))).rejects.toThrow(/permission denied/);
  });

  it('convite só aparece para a própria empresa ou para quem tem o token certo', async () => {
    expect(await convites({ tenantId: A, userId: null })).toBe(1);
    expect(await convites({ tenantId: B, userId: null })).toBe(0);
    expect(await convites({ tenantId: null, userId: null, conviteHash: 'hash-do-convite-a' })).toBe(1);
    expect(await convites({ tenantId: null, userId: null, conviteHash: 'outro-hash' })).toBe(0);
  });

  it('migrations são idempotentes', async () => {
    expect(await migrate(OWNER)).toEqual([]);
  });
});
