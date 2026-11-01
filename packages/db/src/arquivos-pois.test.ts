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

describe('entorno (cache do OSM) e telemetria do viewer no banco', () => {
  const PREDIOS = JSON.stringify([{ osmId: 'way/1', alturaM: 30, contorno: [{ lat: -23.56, lon: -46.65 }] }]);
  const gravarEntorno = (c: pg.PoolClient, projeto: string) =>
    c.query(
      `INSERT INTO entornos (project_id, centro, raio_m, predios) VALUES ($1, ST_SetSRID(ST_MakePoint(-46.65, -23.56), 4326), 500, $2::jsonb)
       ON CONFLICT (project_id) DO UPDATE SET predios = EXCLUDED.predios, atualizado_em = now()`,
      [projeto, PREDIOS],
    );

  it('um entorno por projeto, isolado por empresa', async () => {
    await comoA((c) => gravarEntorno(c, projA));
    await comoA((c) => gravarEntorno(c, projA)); // atualizar não duplica
    expect(await comoA(async (c) => (await c.query('SELECT raio_m, jsonb_array_length(predios) AS n FROM entornos')).rows)).toEqual([{ raio_m: 500, n: 1 }]);
    expect(await comoB(async (c) => (await c.query('SELECT * FROM entornos')).rowCount)).toBe(0);
  });

  it('BLINDAGEM: não grava entorno no projeto de outra empresa; prédios precisam ser uma lista', async () => {
    await expect(comoA((c) => gravarEntorno(c, projB))).rejects.toThrow(/foreign key/);
    await expect(
      comoB((c) => c.query("INSERT INTO entornos (project_id, centro, raio_m, predios) VALUES ($1, ST_SetSRID(ST_MakePoint(0, 0), 4326), 500, '{}')", [projB])),
    ).rejects.toThrow(/check/);
  });

  const telemetria = (c: pg.PoolClient, predio: string, fps = 58.5) =>
    c.query("INSERT INTO telemetria_viewer (building_id, carga_ms, fps_medio, nivel, erros, celular) VALUES ($1, 1800, $2, 'alto', 0, false)", [predio, fps]);

  it('telemetria: grava, só a própria empresa lê, e não aceita valores absurdos', async () => {
    await comoA((c) => telemetria(c, predioA));
    expect(await comoA(async (c) => (await c.query('SELECT carga_ms, fps_medio::float AS fps, nivel FROM telemetria_viewer')).rows)).toEqual([
      { carga_ms: 1800, fps: 58.5, nivel: 'alto' },
    ]);
    expect(await comoB(async (c) => (await c.query('SELECT * FROM telemetria_viewer')).rowCount)).toBe(0);
    await expect(comoA((c) => telemetria(c, predioA, 9999))).rejects.toThrow(/check/);
    await expect(comoB((c) => telemetria(c, predioA))).rejects.toThrow(/foreign key/);
  });

  it('telemetria é só de anotar: a aplicação não altera nem apaga', async () => {
    await expect(comoA((c) => c.query('UPDATE telemetria_viewer SET erros = 5'))).rejects.toThrow(/permission denied/);
    await expect(comoA((c) => c.query('DELETE FROM telemetria_viewer'))).rejects.toThrow(/permission denied/);
  });
});

describe('capturas (fotos/vídeo → 3D) e fila do worker', () => {
  const capturaArquivo = (c: pg.PoolClient, projeto: string, chave: string) =>
    c
      .query<{ id: string }>("INSERT INTO assets (project_id, tipo, nome, chave, tamanho_declarado) VALUES ($1, 'captura', 'sala.zip', $2, 1000) RETURNING id", [projeto, chave])
      .then((r) => r.rows[0]!.id);
  const novaCaptura = (c: pg.PoolClient, projeto: string, arquivo: string, nome: string) =>
    c.query<{ id: string }>("INSERT INTO capturas (project_id, arquivo_id, nome, status) VALUES ($1, $2, $3, 'na_fila') RETURNING id", [projeto, arquivo, nome]).then((r) => r.rows[0]!.id);
  const pegar = (pool: pg.Pool) => pool.query<{ id: string; tenant_id: string }>('SELECT * FROM pegar_proxima_captura()').then((r) => r.rows[0] ?? null);
  let capA = '';
  let capB = '';

  it('captura nasce ligada a um arquivo do tipo captura; isolada por empresa; status só com valores válidos', async () => {
    const arqA = await comoA((c) => capturaArquivo(c, projA, 'a/sala.zip'));
    capA = await comoA((c) => novaCaptura(c, projA, arqA, 'Sala A'));
    expect(await comoB(async (c) => (await c.query('SELECT * FROM capturas')).rowCount)).toBe(0);
    await expect(comoA((c) => c.query("UPDATE capturas SET status = 'pronta_demais' WHERE id = $1", [capA]))).rejects.toThrow(/check/);
    const arqB = await comoB((c) => capturaArquivo(c, projB, 'b/sala.zip'));
    // BLINDAGEM: arquivo de outra empresa não vira captura
    await expect(comoA((c) => novaCaptura(c, projA, arqB, 'Invasão'))).rejects.toThrow(/foreign key/);
    capB = await comoB((c) => novaCaptura(c, projB, arqB, 'Sala B'));
  });

  it('o worker pega a mais antiga de qualquer empresa, marca processando e conta a tentativa; fila vazia devolve nada', async () => {
    // checagem barata do GitHub Actions: enxerga a fila de todas as empresas sem contexto de empresa
    const pendente = () => app.query<{ p: boolean }>('SELECT ha_captura_pendente() AS p').then((r) => r.rows[0]!.p);
    expect(await pendente()).toBe(true);
    const p1 = await pegar(app);
    expect(p1).toEqual({ id: capA, tenant_id: A });
    const p2 = await pegar(app);
    expect(p2).toEqual({ id: capB, tenant_id: B });
    expect(await pegar(app)).toBeNull();
    expect(await pendente()).toBe(false);
    expect(await comoA(async (c) => (await c.query('SELECT status, tentativas FROM capturas')).rows)).toEqual([{ status: 'processando', tentativas: 1 }]);
  });

  it('captura parada (worker caiu) volta a ser pega depois do prazo', async () => {
    expect(await app.query("SELECT * FROM pegar_proxima_captura('1 hour')").then((r) => r.rowCount)).toBe(0);
    await owner.query("UPDATE capturas SET trabalho_em = now() - interval '3 hours' WHERE id = $1", [capA]);
    expect(await pegar(app)).toEqual({ id: capA, tenant_id: A });
    expect(await comoA(async (c) => (await c.query('SELECT tentativas FROM capturas')).rows[0].tentativas)).toBe(2);
  });

  it('dois workers ao mesmo tempo nunca pegam a mesma captura', async () => {
    await owner.query("UPDATE capturas SET status = 'na_fila', trabalho_em = NULL");
    const [x, y] = await Promise.all([pegar(app), pegar(app)]);
    expect(x && y && x.id !== y.id).toBe(true);
  });
});

describe('configurador: catálogo de materiais e móveis, combinações salvas', () => {
  const material = (c: pg.PoolClient, nome: string, extra = '') =>
    c.query<{ id: string }>(`INSERT INTO materiais (nome, categoria, padrao, cor${extra ? ', preco_m2' : ''}) VALUES ($1, 'piso', 'porcelanato', '#d9d4c7'${extra ? `, ${extra}` : ''}) RETURNING id`, [nome]).then((r) => r.rows[0]!.id);

  it('material nasce na empresa, com nome único por empresa e só valores válidos', async () => {
    await comoA((c) => material(c, 'Porcelanato Areia', '89.90'));
    expect(await comoB(async (c) => (await c.query('SELECT * FROM materiais')).rowCount)).toBe(0);
    // outra empresa pode ter um material com o mesmo nome
    await comoB((c) => material(c, 'Porcelanato Areia'));
    await expect(comoA((c) => material(c, 'Porcelanato Areia'))).rejects.toThrow(/unique/);
    await expect(comoA((c) => c.query("INSERT INTO materiais (nome, categoria, cor) VALUES ('Cor ruim', 'piso', 'vermelho')"))).rejects.toThrow(/check/);
    await expect(comoA((c) => c.query("INSERT INTO materiais (nome, categoria, cor, rugosidade) VALUES ('Brilho demais', 'piso', '#ffffff', 1.5)"))).rejects.toThrow(/check|overflow/);
    await expect(comoA((c) => c.query("INSERT INTO materiais (nome, categoria, cor) VALUES ('Sem categoria', 'carro', '#ffffff')"))).rejects.toThrow(/check/);
    // catálogo não se apaga (combinações antigas dependem dele): só desativa
    await expect(comoA((c) => c.query('DELETE FROM materiais'))).rejects.toThrow(/permission denied/);
  });

  it('móvel exige licença e autor, e é padrão OU arquivo da própria empresa', async () => {
    const lic = "'Própria (Imersa 3D)', 'Imersa 3D'";
    await comoA((c) => c.query(`INSERT INTO moveis (nome, categoria, modelo_padrao, licenca, autor) VALUES ('Sofá 3 lugares', 'sala', 'sofa-3', ${lic})`));
    await expect(comoA((c) => c.query("INSERT INTO moveis (nome, categoria, modelo_padrao, autor) VALUES ('Sem licença', 'sala', 'sofa-3', 'x')"))).rejects.toThrow(/null value/);
    await expect(comoA((c) => c.query(`INSERT INTO moveis (nome, categoria, licenca, autor) VALUES ('Sem modelo', 'sala', ${lic})`))).rejects.toThrow(/check/);
    const glbA = await comoA((c) => c.query<{ id: string }>("INSERT INTO assets (project_id, tipo, nome, chave, tamanho_declarado) VALUES ($1, 'modelo_3d', 'poltrona.glb', 'a/poltrona.glb', 1000) RETURNING id", [projA]).then((r) => r.rows[0]!.id));
    await expect(comoA((c) => c.query(`INSERT INTO moveis (nome, categoria, modelo_padrao, asset_id, licenca, autor) VALUES ('Os dois', 'sala', 'sofa-3', $1, ${lic})`, [glbA]))).rejects.toThrow(/check/);
    await comoA((c) => c.query("INSERT INTO moveis (nome, categoria, asset_id, licenca, autor, fonte_url) VALUES ('Poltrona', 'sala', $1, 'CC BY 4.0', 'Estúdio X', 'https://exemplo.com/poltrona')", [glbA]));
    // BLINDAGEM: arquivo de outra empresa não vira móvel
    await expect(comoB((c) => c.query(`INSERT INTO moveis (nome, categoria, asset_id, licenca, autor) VALUES ('Roubado', 'sala', $1, ${lic})`, [glbA]))).rejects.toThrow(/foreign key/);
    await expect(comoA((c) => c.query("INSERT INTO moveis (nome, categoria, modelo_padrao, licenca, autor, fonte_url) VALUES ('Link http', 'sala', 'mesa-4', 'x1', 'x1', 'http://inseguro.com')"))).rejects.toThrow(/check/);
  });

  it('combinação fica no prédio da empresa; unidade de outra empresa é recusada', async () => {
    const unidade = await comoA((c) => c.query<{ id: string }>("INSERT INTO units (building_id, floor_id, codigo) VALUES ($1, $2, '901') RETURNING id", [predioA, andarA]).then((r) => r.rows[0]!.id));
    const nova = (c: pg.PoolClient, predio: string, unidadeId: string | null) =>
      c.query("INSERT INTO configuracoes (building_id, unit_id, nome, escolhas, orcamento, total) VALUES ($1, $2, 'Opção A', '{}', '{}', 0)", [predio, unidadeId]);
    await comoA((c) => nova(c, predioA, unidade));
    expect(await comoB(async (c) => (await c.query('SELECT * FROM configuracoes')).rowCount)).toBe(0);
    await expect(comoB((c) => nova(c, predioA, null))).rejects.toThrow(/foreign key/);
    await expect(comoA((c) => c.query("INSERT INTO configuracoes (building_id, nome, escolhas, orcamento, total) VALUES ($1, 'Lista', '[]', '{}', 0)", [predioA]))).rejects.toThrow(/check/);
    // apagar a unidade não apaga a combinação (só desliga)
    await owner.query('DELETE FROM units WHERE id = $1', [unidade]);
    expect(await comoA(async (c) => (await c.query('SELECT unit_id FROM configuracoes')).rows)).toEqual([{ unit_id: null }]);
    expect(await comoA(async (c) => (await c.query('DELETE FROM configuracoes')).rowCount)).toBe(1);
  });
});

describe('plantas: leitura da planta → editor → 3D', () => {
  it('planta isolada por empresa, só de arquivo da empresa, uma leitura ativa por arquivo e fila entre empresas', async () => {
    const arquivo = (c: pg.PoolClient, projeto: string, chave: string) =>
      c.query<{ id: string }>("INSERT INTO assets (project_id, tipo, nome, chave, tamanho_declarado) VALUES ($1, 'planta', 'planta.pdf', $2, 1000) RETURNING id", [projeto, chave]).then((r) => r.rows[0]!.id);
    const arqA = await comoA((c) => arquivo(c, projA, 'a/planta.pdf'));
    const arqB = await comoB((c) => arquivo(c, projB, 'b/planta.pdf'));
    const nova = (c: pg.PoolClient, projeto: string, arq: string) => c.query<{ id: string }>('INSERT INTO plantas (project_id, arquivo_id) VALUES ($1, $2) RETURNING id', [projeto, arq]).then((r) => r.rows[0]!.id);
    const pA = await comoA((c) => nova(c, projA, arqA));
    await expect(comoA((c) => nova(c, projA, arqA))).rejects.toThrow(/plantas_ativa_uk/);
    // BLINDAGEM: arquivo de outra empresa não vira planta
    await expect(comoA((c) => nova(c, projA, arqB))).rejects.toThrow(/foreign key/);
    expect(await comoB(async (c) => (await c.query('SELECT * FROM plantas')).rowCount)).toBe(0);
    await comoB((c) => nova(c, projB, arqB));
    const pegar = () => app.query<{ id: string; tenant_id: string }>('SELECT * FROM pegar_proxima_planta()').then((r) => r.rows[0] ?? null);
    expect(await pegar()).toEqual({ id: pA, tenant_id: A });
    expect((await pegar())?.tenant_id).toBe(B);
    expect(await pegar()).toBeNull();
    await expect(comoA((c) => c.query("UPDATE plantas SET edicao = '[]' WHERE id = $1", [pA]))).rejects.toThrow(/check/);
  });
});
