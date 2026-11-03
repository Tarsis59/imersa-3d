import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { codigoTotp } from '../../api/src/auth/totp';

/**
 * Demonstração permanente NO AR: cria (uma vez) a empresa "imersa-demonstracao" no site de verdade, com três
 * empreendimentos completos para o dono do produto continuar vendo e mexendo:
 *   1. Residencial Imersa (torre na Av. Paulista: unidades, lazer, galeria, proximidades, marca, link do cliente, estande);
 *   2. Reserva Imersa (loteamento: 9 lotes do DXF, clube, casa-modelo, daqui a 10 anos);
 *   3. Casa Imersa BIM (casa FZK real, IFC convertido no Render).
 * NÃO é teste de regressão e NÃO apaga nada no fim. Só roda com DEMONSTRACAO=1.
 * A senha e o segredo do autenticador vão só para o .env da raiz (DEMO_*), nunca para o terminal; cada etapa
 * concluída grava DEMO_*_OK=1, então rodar de novo só refaz o que faltou.
 * Uso: DEMONSTRACAO=1 pnpm --filter @imersa/web exec playwright test -c e2e-producao demonstracao
 */
const API = process.env.API_PRODUCAO ?? 'https://imersa-api.onrender.com';
const ENV = fileURLToPath(new URL('../../../../.env', import.meta.url));
const PASTA = process.env.PASTA_CAPTURAS ?? fileURLToPath(new URL('../test-results/mostruario', import.meta.url));
mkdirSync(PASTA, { recursive: true });
const FOTO = readFileSync(new URL('../e2e/fixtures/video-fzk-capa.jpg', import.meta.url));
const FZK = fileURLToPath(new URL('../../../exemplos/projeto-bim/AC20-FZK-Haus.ifc', import.meta.url));
const LAT_PAULISTA = '-23.56175';
const LON_PAULISTA = '-46.6545';

test.describe.configure({ mode: 'serial' });
// placa de vídeo da máquina (as capturas saem com a qualidade de um aparelho de verdade)
test.use({ viewport: { width: 1600, height: 1000 }, launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=default'] } });

function lerEnv(): Record<string, string> {
  const r: Record<string, string> = {};
  for (const linha of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) r[m[1]!] = m[2]!;
  }
  return r;
}
function gravarEnv(chave: string, valor: string) {
  const texto = readFileSync(ENV, 'utf8');
  appendFileSync(ENV, `${texto.endsWith('\n') ? '' : '\n'}${chave}=${valor}\n`);
}

interface Legenda { arquivo: string; titulo: string; descricao: string }
async function capturar(pagina: Page, arquivo: string, titulo: string, descricao: string) {
  await pagina.screenshot({ path: `${PASTA}/${arquivo}` });
  const caminho = `${PASTA}/legendas.json`;
  const atuais: Legenda[] = existsSync(caminho) ? JSON.parse(readFileSync(caminho, 'utf8')) : [];
  const resto = atuais.filter((x) => x.arquivo !== arquivo);
  resto.push({ arquivo, titulo, descricao });
  resto.sort((a, b) => a.arquivo.localeCompare(b.arquivo));
  writeFileSync(caminho, JSON.stringify(resto, null, 2));
}
async function assentar(pagina: Page, ms = 2500) {
  await pagina.evaluate(() => window.scrollTo(0, 0));
  await pagina.waitForTimeout(ms);
}
async function abrirEmAlta(pagina: Page) {
  await pagina.waitForURL(/\/vitrine/);
  const url = new URL(pagina.url());
  url.searchParams.set('qualidade', 'alto');
  await pagina.goto(url.toString());
  const vitrine = pagina.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
  await expect(vitrine).toHaveAttribute('data-acabamento', 'ligado', { timeout: 60_000 });
  return vitrine;
}

// o mesmo código de 6 dígitos não vale duas vezes: cada uso espera a próxima janela de 30 s
let ultimaJanela = -1;
async function codigoNovo(pagina: Page, segredo: string) {
  while (Math.floor(Date.now() / 30_000) === ultimaJanela) await pagina.waitForTimeout(1000);
  ultimaJanela = Math.floor(Date.now() / 30_000);
  return codigoTotp(segredo);
}

interface Conta { empresa: string; email: string; senha: string; segredo: string }
async function conta(page: Page, request: APIRequestContext): Promise<Conta> {
  await expect.poll(async () => (await request.get(`${API}/health`, { timeout: 120_000 }).catch(() => null))?.status(), { timeout: 240_000 }).toBe(200);
  if (!lerEnv().DEMO_EMPRESA) {
    const empresa = 'imersa-demonstracao';
    const email = 'demo@imersa-demonstracao.example.com';
    const senha = `Demo-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
    const reg = await request.post(`${API}/auth/registro`, { data: { empresa: { nome: 'Imersa Demonstração', slug: empresa }, nome: 'Demonstração Imersa', email, senha } });
    expect(reg.status(), await reg.text()).toBe(201);
    gravarEnv('DEMO_EMPRESA', empresa);
    gravarEnv('DEMO_EMAIL', email);
    gravarEnv('DEMO_SENHA', senha);
  }
  const env = lerEnv();
  const c = { empresa: env.DEMO_EMPRESA!, email: env.DEMO_EMAIL!, senha: env.DEMO_SENHA!, segredo: env.DEMO_MFA_SEGREDO ?? '' };
  await page.goto('/login');
  await page.getByLabel('Empresa').fill(c.empresa);
  await page.getByLabel('E-mail').fill(c.email);
  await page.getByLabel('Senha').fill(c.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  if (c.segredo) {
    const campo = page.getByLabel('Código do autenticador');
    await expect(campo).toBeVisible({ timeout: 60_000 });
    // o formulário volta com empresa e e-mail, mas a senha vem em branco
    await page.getByLabel('Senha').fill(c.senha);
    await campo.fill(await codigoNovo(page, c.segredo));
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/painel$/, { timeout: 60_000 });
    return c;
  }
  // primeira entrada: liga o segundo fator (obrigatório para a gestão) e guarda o segredo só no .env
  await expect(page).toHaveURL(/\/painel$/, { timeout: 60_000 });
  await page.goto('/painel/seguranca');
  await page.getByRole('button', { name: 'Gerar código QR' }).click();
  c.segredo = (await page.getByTestId('segredo-mfa').textContent())?.trim() ?? '';
  expect(c.segredo).not.toBe('');
  await page.getByLabel('Código de 6 dígitos').fill(await codigoNovo(page, c.segredo));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  gravarEnv('DEMO_MFA_SEGREDO', c.segredo);
  return c;
}
async function tokenApi(page: Page, request: APIRequestContext, c: Conta) {
  const r = await request.post(`${API}/auth/login`, { data: { email: c.email, senha: c.senha, empresa: c.empresa, codigoMfa: await codigoNovo(page, c.segredo) } });
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { acesso: string }).acesso;
}

async function novoProjeto(page: Page, nome: string, comLocal: boolean) {
  await page.goto('/painel');
  await page.getByLabel('Nome do projeto').fill(nome);
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: new RegExp(`^${nome}`) }).first().click();
  await page.waitForURL(/\/painel\/projetos\/[^/]+$/);
  if (comLocal) {
    await page.getByLabel('Latitude').fill(LAT_PAULISTA);
    await page.getByLabel('Longitude').fill(LON_PAULISTA);
    await page.getByRole('button', { name: 'Salvar dados' }).click();
    await expect(page.getByText('Dados salvos.')).toBeVisible();
  }
  return new URL(page.url()).pathname.split('/').at(-1)!;
}
async function predioComPlanilha(page: Page, nome: string, andares: number, planilha?: string) {
  await page.getByLabel('Nome do prédio').fill(nome);
  await page.getByLabel('Andares').fill(String(andares));
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  if (!planilha) return;
  await page.getByLabel('Conteúdo da planilha').fill(planilha);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await expect(page.getByText('Prévia (nada foi gravado).')).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
}
async function enviarFoto(request: APIRequestContext, acesso: string, projetoId: string, nome: string) {
  const declarado = await request.post(`${API}/projetos/${projetoId}/arquivos`, { headers: { authorization: `Bearer ${acesso}` }, data: { nome, tipo: 'imagem', tamanho: FOTO.length } });
  expect(declarado.status(), await declarado.text()).toBeLessThan(300);
  const { id, envio } = (await declarado.json()) as { id: string; envio: { url: string } };
  const put = await request.put(envio.url, { headers: { 'content-type': 'application/octet-stream' }, data: FOTO });
  expect(put.status()).toBeLessThan(300);
  await concluirFoto(request, acesso, id);
}
/** No envio direto ao R2 o navegador avisa que terminou e a API verifica (no teste local o disco já conclui sozinho). */
async function concluirFoto(request: APIRequestContext, acesso: string, id: string) {
  const fim = await request.post(`${API}/arquivos/${id}/concluir`, { headers: { authorization: `Bearer ${acesso}` } });
  expect(fim.status(), await fim.text()).toBe(200);
  expect(((await fim.json()) as { status: string }).status).toBe('pronto');
}
/** Retomada: devolve o id do projeto com esse nome, se uma rodada anterior já o criou. */
async function projetoExistente(request: APIRequestContext, acesso: string, nome: string) {
  const r = await request.get(`${API}/projetos`, { headers: { authorization: `Bearer ${acesso}` } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as Array<{ id: string; nome: string }>).find((p) => p.nome === nome)?.id;
}
async function detalheProjeto(request: APIRequestContext, acesso: string, id: string) {
  const r = await request.get(`${API}/projetos/${id}`, { headers: { authorization: `Bearer ${acesso}` } });
  expect(r.status()).toBe(200);
  return (await r.json()) as { predios: Array<{ nome: string; unidades: number }> };
}
/** No espelho de vendas: gera o link do cliente (com o WhatsApp do corretor) e devolve o endereço. */
async function linkDoCliente(page: Page, whatsapp: string) {
  await page.getByLabel('Para quem (opcional)').fill('Cliente Demonstração');
  await page.getByLabel('Seu WhatsApp (opcional)').fill(whatsapp);
  await page.getByRole('button', { name: 'Gerar link' }).click();
  return (await page.getByTestId('link-cliente').textContent())!.trim();
}

const PLANILHA_TORRE = [
  'predio;andar;codigo;tipologia;area_m2;quartos;preco;status',
  ...[1, 2, 3, 4, 5, 6].flatMap((a) => [
    `Torre Imersa;${a};${a}01;Tipo 2Q;70;2;${640 + a * 10}.000,00;${a === 1 ? 'reservado' : 'disponivel'}`,
    `Torre Imersa;${a};${a}02;Tipo 3Q;98;3;${900 + a * 12}.000,00;disponivel`,
    `Torre Imersa;${a};${a}03;Tipo 2Q;70;2;${650 + a * 10}.000,00;${a % 3 === 0 ? 'vendido' : 'disponivel'}`,
    `Torre Imersa;${a};${a}04;Tipo 3Q;98;3;${910 + a * 12}.000,00;${a === 2 ? 'reservado' : a === 5 ? 'vendido' : 'disponivel'}`,
  ]),
].join('\n');

test('demonstração 1/3: Residencial Imersa (torre, lazer, galeria, marca, link do cliente e estande)', async ({ page, request, browser }) => {
  test.skip(!process.env.DEMONSTRACAO, 'só roda a pedido (DEMONSTRACAO=1): cria dados permanentes no ar');
  test.skip(lerEnv().DEMO_TORRE_OK === '1', 'já feito');
  test.setTimeout(30 * 60_000);
  const c = await conta(page, request);
  const acesso = await tokenApi(page, request, c);
  let projetoId = await projetoExistente(request, acesso, 'Residencial Imersa');
  if (projetoId) {
    await page.goto(`/painel/projetos/${projetoId}`);
  } else {
    projetoId = await novoProjeto(page, 'Residencial Imersa', true);
    const poi = await request.post(`${API}/projetos/${projetoId}/pois`, { headers: { authorization: `Bearer ${acesso}` }, data: { categoria: 'transporte', nome: 'Estação Trianon-MASP', lat: -23.5614, lon: -46.6564 } });
    expect(poi.status(), await poi.text()).toBeLessThan(300);
  }
  if (!(await detalheProjeto(request, acesso, projetoId)).predios.some((p) => p.nome === 'Torre Imersa' && p.unidades === 24)) {
    await predioComPlanilha(page, 'Torre Imersa', 6, PLANILHA_TORRE);
  }
  const arquivos = (await (await request.get(`${API}/projetos/${projetoId}/arquivos`, { headers: { authorization: `Bearer ${acesso}` } })).json()) as Array<{ id: string; nome: string; status: string }>;
  const foto = arquivos.find((a) => a.nome === 'Fachada Imersa.jpg');
  if (!foto) await enviarFoto(request, acesso, projetoId, 'Fachada Imersa.jpg');
  else if (foto.status !== 'pronto') await concluirFoto(request, acesso, foto.id);

  await page.goto(`/painel/projetos/${projetoId}`);
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.waitForURL(/\/painel\/predios\/[^/]+$/);
  const urlEspelho = page.url();
  if (!lerEnv().DEMO_LINK_TORRE) gravarEnv('DEMO_LINK_TORRE', await linkDoCliente(page, '(11) 98888-1234'));

  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
  const cartaoLazer = page.getByTestId('lazer');
  const marcar = async (tipo: string, nome: string, descricao: string, fx: number, foto?: string) => {
    await cartaoLazer.getByLabel('Tipo').selectOption({ label: tipo });
    await cartaoLazer.getByLabel('Nome do espaço').fill(nome);
    await cartaoLazer.getByLabel('Descrição (opcional)').fill(descricao);
    if (foto) await cartaoLazer.getByLabel(foto).check();
    await cartaoLazer.getByRole('button', { name: 'Marcar no 3D' }).click();
    await expect(vitrine).toHaveAttribute('data-marcando-lazer', 'sim');
    await vitrine.scrollIntoViewIfNeeded();
    const caixa = (await vitrine.boundingBox())!;
    await page.mouse.click(caixa.x + caixa.width * fx, caixa.y + caixa.height * 0.9);
    await expect(vitrine).toHaveAttribute('data-marcando-lazer', '');
  };
  await expect(vitrine).toHaveAttribute('data-lazer', /^\d+$/, { timeout: 30_000 });
  if ((await vitrine.getAttribute('data-lazer')) === '0') {
    await expect(cartaoLazer.getByLabel('Fachada Imersa.jpg')).toBeVisible({ timeout: 30_000 });
    await marcar('Piscina', 'Piscina Imersa', 'Piscina aquecida com borda infinita', 0.1, 'Fachada Imersa.jpg');
    await marcar('Academia', 'Academia Imersa', 'Equipamentos de última geração, aberta 24h', 0.9);
    await marcar('Playground', 'Playground Imersa', 'Piso emborrachado e brinquedos novos', 0.3);
  }
  await expect(vitrine).toHaveAttribute('data-lazer', '3');
  if ((await page.getByTestId('galeria').getByRole('button').count()) === 0) {
    const gestaoGaleria = page.getByTestId('gestao-galeria');
    await gestaoGaleria.getByLabel('Adicionar foto do projeto').selectOption({ label: 'Fachada Imersa.jpg' });
    await gestaoGaleria.getByRole('button', { name: 'Salvar galeria' }).click();
  }
  await expect(page.getByTestId('galeria').getByRole('button')).toHaveCount(1, { timeout: 30_000 });

  // marca da incorporadora (cor verde + a foto como logo): vale para todos os links da empresa
  await page.goto('/painel/marca');
  await page.getByLabel('Cor primária').evaluate((el: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, '#16a34a');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const seletorLogo = page.getByLabel('Logo (foto já enviada no projeto)');
  await expect(seletorLogo.locator('option', { hasText: 'Fachada Imersa.jpg' })).toHaveCount(1, { timeout: 30_000 });
  await seletorLogo.selectOption({ label: 'Fachada Imersa.jpg' });
  await page.getByRole('button', { name: 'Salvar marca' }).click();
  await expect(page.getByText('Marca salva.')).toBeVisible();

  // estande em apresentação automática (14)
  let endereco = lerEnv().DEMO_LINK_ESTANDE;
  if (!endereco) {
    await page.goto(urlEspelho);
    const secao = page.getByTestId('estandes');
    await secao.getByLabel('Nome do estande').fill('Estande Imersa');
    await secao.getByRole('button', { name: 'Criar estande' }).click();
    endereco = (await page.getByTestId('endereco-estande').textContent())!.trim();
    gravarEnv('DEMO_LINK_ESTANDE', endereco);
  }
  const pc = await browser.newContext({ viewport: { width: 1600, height: 1000 }, hasTouch: true });
  const tela = await pc.newPage();
  await tela.goto(`${endereco}?ocioso=9999`);
  const vitrineEstande = tela.getByTestId('vitrine-3d');
  await expect(vitrineEstande).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
  await expect(tela.getByTestId('apresentacao-unidade')).toContainText(/Unidade \d{3}/, { timeout: 30_000 });
  await assentar(tela, 4000);
  await capturar(tela, '14-estande-apresentacao.png', 'Estande em apresentação automática', 'Tela do estande (PC em modo quiosque) apresentando sozinha as unidades disponíveis, para quem passa em frente.');
  await pc.close();
  gravarEnv('DEMO_TORRE_OK', '1');
});

/** DXF do parcelamento: 3 quadras de 3 lotes de 12×30 m perto da Av. Paulista, com rua/calçada/meio-fio a leste. */
function dxfLoteamento(): string {
  const poli = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '1', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
  const linha = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '0', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
  const texto = (camada: string, x: number, y: number, t: string) => ['0', 'TEXT', '8', camada, '10', String(x), '20', String(y), '40', '1.5', '1', t];
  const e: string[] = [];
  const [x0, y0] = [331_120, 7_393_250];
  for (const [q, dy] of [[1, 0], [2, 50], [3, 100]] as const) {
    e.push(...poli('QUADRAS', [[x0 - 2, y0 + dy - 2], [x0 + 38, y0 + dy - 2], [x0 + 38, y0 + dy + 32], [x0 - 2, y0 + dy + 32]]), ...texto('QUADRAS', x0 + 30, y0 + dy + 31, `Q-${q}`));
    for (let l = 0; l < 3; l++) {
      const x = x0 + l * 12;
      e.push(...poli('LOTES', [[x, y0 + dy], [x + 12, y0 + dy], [x + 12, y0 + dy + 30], [x, y0 + dy + 30]]), ...texto('NUMEROS', x + 6, y0 + dy + 15, String(l + 1)));
    }
  }
  e.push(...linha('CALCADAS', [[x0 + 37.5, y0 - 5], [x0 + 37.5, y0 + 135]]));
  e.push(...linha('MEIO_FIO', [[x0 + 39, y0 - 5], [x0 + 39, y0 + 135]]));
  e.push(...linha('RUAS', [[x0 + 41, y0 - 5], [x0 + 41, y0 + 135]]));
  return ['0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

test('demonstração 2/3: Reserva Imersa (loteamento)', async ({ page, request }) => {
  test.skip(!process.env.DEMONSTRACAO, 'só roda a pedido (DEMONSTRACAO=1): cria dados permanentes no ar');
  test.skip(lerEnv().DEMO_LOTEAMENTO_OK === '1', 'já feito');
  test.setTimeout(30 * 60_000);
  const c = await conta(page, request);
  const acesso = await tokenApi(page, request, c);
  // retomada: reaproveita o projeto, o prédio, o link, os lotes e o clube de uma rodada que parou no meio
  let projetoId = await projetoExistente(request, acesso, 'Reserva Imersa');
  if (projetoId) await page.goto(`/painel/projetos/${projetoId}`);
  else projetoId = await novoProjeto(page, 'Reserva Imersa', true);
  if (!(await detalheProjeto(request, acesso, projetoId)).predios.some((p) => p.nome === 'Loteamento')) await predioComPlanilha(page, 'Loteamento', 1);
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.waitForURL(/\/painel\/predios\/[^/]+$/);
  const predioId = new URL(page.url()).pathname.split('/').at(-1)!;
  if (!lerEnv().DEMO_LINK_LOTEAMENTO) gravarEnv('DEMO_LINK_LOTEAMENTO', await linkDoCliente(page, '(11) 97777-5678'));

  // o importador de lotes fica no espelho do prédio
  const lotes = (await (await request.get(`${API}/predios/${predioId}/lotes`, { headers: { authorization: `Bearer ${acesso}` } })).json()) as unknown;
  const qtdLotes = Array.isArray(lotes) ? lotes.length : Array.isArray((lotes as { lotes?: unknown[] }).lotes) ? (lotes as { lotes: unknown[] }).lotes.length : 0;
  if (qtdLotes === 0) {
    const importar = page.getByTestId('importar-lotes');
    await importar.getByLabel('Arquivo do loteamento').setInputFiles({ name: 'reserva-imersa.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxfLoteamento()) });
    await importar.getByRole('button', { name: 'Ver a prévia' }).click();
    await expect(page.getByTestId('previa-lotes')).toContainText('Prévia (nada foi gravado): 9 lotes em 3 quadras');
    await importar.getByRole('button', { name: 'Gravar os lotes' }).click();
    await expect(page.getByTestId('previa-lotes')).toContainText('Gravado: 9 lotes');
  }

  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  let vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
  await expect(vitrine).toHaveAttribute('data-lazer', /^\d+$/, { timeout: 30_000 });
  if ((await vitrine.getAttribute('data-lazer')) === '0') {
    const cartaoLazer = page.getByTestId('lazer');
    await cartaoLazer.getByLabel('Tipo').selectOption({ label: 'Salão de festas' });
    await cartaoLazer.getByLabel('Nome do espaço').fill('Clube Social Imersa');
    await cartaoLazer.getByLabel('Descrição (opcional)').fill('Salão de festas, piscina e quadra do loteamento');
    await cartaoLazer.getByRole('button', { name: 'Marcar no 3D' }).click();
    await expect(vitrine).toHaveAttribute('data-marcando-lazer', 'sim');
    await vitrine.scrollIntoViewIfNeeded();
    const caixa = (await vitrine.boundingBox())!;
    await page.mouse.click(caixa.x + caixa.width * 0.5, caixa.y + caixa.height * 0.6);
    await expect(vitrine).toHaveAttribute('data-marcando-lazer', '');
  }
  await expect(vitrine).toHaveAttribute('data-lazer', '1');

  vitrine = await abrirEmAlta(page);
  await expect(vitrine).toHaveAttribute('data-lotes', '9', { timeout: 60_000 });
  // a cidade em volta vem do Overpass (OSM, grátis): se estiver fora do ar, o loteamento segue sem ela e a cidade entra quando ele voltar
  await expect(vitrine).toHaveAttribute('data-entorno', /^\d+$|^indisponivel$/, { timeout: 90_000 });
  await expect(vitrine).toHaveAttribute('data-anos', '10', { timeout: 30_000 });
  await page.getByLabel('Dia do sol').fill('2026-06-21');
  await page.getByLabel(/^Hora/).fill('11');
  await assentar(page);
  await capturar(page, '15-loteamento-geral.png', 'Loteamento na cidade', 'Os lotes no chão, com grama, rua, calçada e árvores (já crescidas), dentro da cidade real em volta.');

  const busca = page.getByTestId('buscador-lotes');
  await busca.getByRole('group', { name: 'Quadras' }).getByRole('button', { name: '02' }).click();
  await expect(vitrine).toHaveAttribute('data-varredura', 'sim', { timeout: 5_000 }).catch(() => null);
  await capturar(page, '16-buscador-varredura-ciano.png', 'Buscador de lotes', 'Ao filtrar por quadra, um anel ciano varre os lotes que combinam com a busca.');
  await expect(vitrine).toHaveAttribute('data-varredura', 'nao', { timeout: 15_000 });
  await expect(busca.getByTestId('contagem-lotes')).toHaveText('3 de 9 lotes');

  await busca.getByTestId('lista-lotes').getByRole('button', { name: /Q02 · L01/ }).click();
  const card = page.getByTestId('lote-selecionado');
  await expect(card).toContainText('Até o clube', { timeout: 30_000 });
  await assentar(page);
  await capturar(page, '17-card-do-lote.png', 'Card do lote', 'Área, frente × fundo, preço, para onde o sol bate e a distância a pé até o clube do loteamento.');

  await card.getByTestId('casa-modelo').click();
  await expect(vitrine).toHaveAttribute('data-casa-modelo', /.+/, { timeout: 30_000 });
  await card.getByTestId('ver-daqui').click();
  await expect(vitrine).toHaveAttribute('data-vista-lote', /.+/, { timeout: 30_000 });
  await assentar(page);
  await capturar(page, '18-casa-modelo-vista-1-60m.png', 'Casa-modelo no lote, vista a 1,60 m', 'A casa-modelo já nas medidas do lote, vista da calçada, na altura dos olhos de uma pessoa.');

  // as árvores aparecem de cima: volta à visão geral antes do antes/depois
  // depois do "Ver daqui" a visão geral não volta a câmera para cima (defeito anotado): recarrega a Vitrine
  await page.reload();
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
  await expect(vitrine).toHaveAttribute('data-anos', '10', { timeout: 30_000 });
  const controle = page.getByTestId('daqui-a-10-anos').getByLabel(/Árvores do loteamento/);
  await controle.focus();
  await controle.press('Home');
  await expect(vitrine).toHaveAttribute('data-anos', '0', { timeout: 15_000 });
  await assentar(page);
  await capturar(page, '19-loteamento-recem-plantado.png', 'Loteamento recém-plantado', 'No dia zero: grama e árvores acabadas de plantar.');
  await controle.press('End');
  await expect(vitrine).toHaveAttribute('data-anos', '10', { timeout: 15_000 });
  await assentar(page);
  await capturar(page, '20-loteamento-daqui-a-10-anos.png', 'Daqui a 10 anos', 'As mesmas árvores, dez anos depois: o loteamento com a vegetação já crescida.');
  gravarEnv('DEMO_LOTEAMENTO_OK', '1');
});

test('demonstração 3/3: Casa Imersa BIM (casa FZK real)', async ({ page, request }) => {
  test.skip(!process.env.DEMONSTRACAO, 'só roda a pedido (DEMONSTRACAO=1): cria dados permanentes no ar');
  test.skip(lerEnv().DEMO_BIM_OK === '1', 'já feito');
  test.setTimeout(30 * 60_000);
  const c = await conta(page, request);
  const acesso = await tokenApi(page, request, c);
  // retomada: reaproveita o projeto, o prédio e o IFC de uma rodada que parou no meio
  let projetoId = await projetoExistente(request, acesso, 'Casa Imersa BIM');
  if (projetoId) await page.goto(`/painel/projetos/${projetoId}`);
  else projetoId = await novoProjeto(page, 'Casa Imersa BIM', false);
  if (!(await detalheProjeto(request, acesso, projetoId)).predios.some((p) => p.nome === 'Casa' && p.unidades === 7)) {
    await predioComPlanilha(page, 'Casa', 2, ['predio;andar;codigo;status', ...[1, 2, 3, 4, 5, 6].map((n) => `Casa;1;${n};disponivel`), 'Casa;2;7;disponivel'].join('\n'));
  }

  const item = page.getByTestId('lista-bim').getByRole('listitem').filter({ hasText: 'AC20-FZK-Haus.ifc' }).first();
  if ((await page.getByTestId('lista-bim').getByRole('listitem').filter({ hasText: 'AC20-FZK-Haus.ifc' }).count()) === 0) {
    await page.locator('#tipo-arquivo').selectOption({ label: 'Projeto BIM (.ifc)' });
    await page.locator('#arquivo-envio').setInputFiles(FZK);
    await page.getByRole('button', { name: 'Enviar arquivo' }).click();
    await expect(page.getByText('AC20-FZK-Haus.ifc enviado e verificado.')).toBeVisible({ timeout: 120_000 });
  }
  await expect(item).toBeVisible({ timeout: 30_000 });
  if (!/^(na_fila|processando|pronto)$/.test((await item.getAttribute('data-status-bim')) ?? '')) {
    await item.getByRole('button', { name: 'Converter para 3D' }).click();
  }
  await expect(item).toHaveAttribute('data-status-bim', /pronto|erro/, { timeout: 400_000 });
  if ((await item.getAttribute('data-status-bim')) === 'erro') throw new Error(`Conversão BIM falhou: ${await item.textContent()}`);
  await item.getByRole('link', { name: 'Vincular ambientes: Casa' }).click();
  await page.getByRole('button', { name: 'Salvar vínculos e usar este modelo' }).click();
  await expect(page.getByText(/unidades vinculadas e modelo ligado ao prédio\./)).toBeVisible();
  // a tela de vínculos não tem o atalho do espelho: abre o espelho do prédio pelo endereço
  await page.goto(new URL(page.url()).pathname.replace(/\/bim$/, ''));
  if (!lerEnv().DEMO_LINK_BIM) gravarEnv('DEMO_LINK_BIM', await linkDoCliente(page, '(11) 96666-4321'));

  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = await abrirEmAlta(page);
  await expect(page.getByTestId('contagem-filtro')).toHaveText('7 de 7 unidades');
  await assentar(page);
  await capturar(page, '21-bim-casa-fzk.png', 'Casa BIM real convertida no 3D', 'Projeto BIM (IFC) real da casa FZK, convertido e otimizado para rodar no navegador.');
  await page.getByLabel('Ver até o andar (corte)').selectOption({ label: '1º andar' });
  await page.getByRole('button', { name: 'Casa de bonecas' }).click();
  await expect(vitrine).toHaveAttribute('data-casa-bonecas', '1', { timeout: 30_000 });
  await assentar(page);
  await capturar(page, '22-bim-casa-bonecas.png', 'Casa de bonecas com paredes reais', 'No BIM, o corte usa as paredes de verdade do projeto (IFC), não paredes geradas automaticamente.');
  gravarEnv('DEMO_BIM_OK', '1');
});

test('demonstração: conferência dos links públicos (cliente sem login)', async ({ browser }) => {
  test.skip(!process.env.DEMONSTRACAO, 'só roda a pedido (DEMONSTRACAO=1)');
  test.setTimeout(10 * 60_000);
  const env = lerEnv();
  const links = (['DEMO_LINK_TORRE', 'DEMO_LINK_LOTEAMENTO', 'DEMO_LINK_BIM', 'DEMO_LINK_ESTANDE'] as const).filter((k) => env[k]);
  expect(links).toHaveLength(4);
  for (const chave of links) {
    const contexto = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pagina = await contexto.newPage();
    await pagina.goto(chave === 'DEMO_LINK_ESTANDE' ? `${env[chave]}?ocioso=9999` : env[chave]!);
    await expect(pagina.getByTestId('vitrine-3d'), chave).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
    await contexto.close();
  }
});
