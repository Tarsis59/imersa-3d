import { fileURLToPath } from 'node:url';
import { test, expect, devices } from '@playwright/test';
import { codigoTotp } from '../../api/src/auth/totp';

// Fluxo completo no ar: cadastro → MFA → projeto → prédio e unidades → IFC enviado direto ao R2 → conversão BIM
// no Render → Vitrine 3D → configurador → link para o cliente → cliente no celular (sem login) → pedido de contato → lead no painel.
// Imprime EMPRESA_TESTE=<slug> para a limpeza depois.
const API = process.env.API_PRODUCAO ?? 'https://imersa-api.onrender.com';
const SITE = process.env.SITE_PRODUCAO ?? 'https://imersa-3d.vercel.app';
const FZK = fileURLToPath(new URL('../../../exemplos/projeto-bim/AC20-FZK-Haus.ifc', import.meta.url));
const PLANILHA = ['predio;andar;codigo;status', ...[1, 2, 3, 4, 5, 6].map((n) => `Casa;1;${n};disponivel`), 'Casa;2;7;vendido'].join('\n');

test('no ar: cadastro → projeto → BIM → Vitrine 3D → link do cliente → lead', async ({ page, request, browser }) => {
  const empresa = `teste-no-ar-${Date.now().toString(36)}`;
  const email = `admin@${empresa}.example.com`;
  const senha = `Teste-${Date.now().toString(36)}-no-ar`;
  console.log(`EMPRESA_TESTE=${empresa}`);
  // a API grátis dorme: a 1ª chamada acorda (~1 min)
  await expect.poll(async () => (await request.get(`${API}/health`, { timeout: 120_000 }).catch(() => null))?.status(), { timeout: 240_000 }).toBe(200);
  const reg = await request.post(`${API}/auth/registro`, { data: { empresa: { nome: 'Teste no ar', slug: empresa }, nome: 'Admin Teste', email, senha } });
  expect(reg.status()).toBe(201);

  await page.goto('/login');
  await page.getByLabel('Empresa').fill(empresa);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/, { timeout: 60_000 });
  await page.goto('/painel/seguranca');
  await page.getByRole('button', { name: 'Gerar código QR' }).click();
  const segredo = (await page.getByTestId('segredo-mfa').textContent())?.trim() ?? '';
  await page.getByLabel('Código de 6 dígitos').fill(codigoTotp(segredo));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page).toHaveURL(/\/painel$/);

  await page.getByLabel('Nome do projeto').fill('Casa FZK');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Casa FZK/ }).click();
  await page.getByLabel('Nome do prédio').fill('Casa');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  const projetoUrl = page.url();

  // envio direto do navegador para o R2 (URL pré-assinada + CORS) e verificação na API
  await page.locator('#tipo-arquivo').selectOption({ label: 'Projeto BIM (.ifc)' });
  await page.locator('#arquivo-envio').setInputFiles(FZK);
  await page.getByRole('button', { name: 'Enviar arquivo' }).click();
  await expect(page.getByText('AC20-FZK-Haus.ifc enviado e verificado.')).toBeVisible({ timeout: 120_000 });

  // conversão BIM de verdade no Render (IfcOpenShell + gltf-transform)
  const item = page.getByTestId('lista-bim').getByRole('listitem').filter({ hasText: 'AC20-FZK-Haus.ifc' });
  await item.getByRole('button', { name: 'Converter para 3D' }).click();
  await expect(item).toHaveAttribute('data-status-bim', /pronto|erro/, { timeout: 400_000 });
  if ((await item.getAttribute('data-status-bim')) === 'erro') throw new Error(`Conversão BIM falhou: ${await item.textContent()}`);
  await expect(item).toContainText('2 pavimentos · 7 ambientes');
  await item.getByRole('link', { name: 'Vincular ambientes: Casa' }).click();
  await expect(page.getByText(/7 vínculos sugeridos/)).toBeVisible();
  await page.getByRole('button', { name: 'Salvar vínculos e usar este modelo' }).click();
  await expect(page.getByText('7 unidades vinculadas e modelo ligado ao prédio.')).toBeVisible();

  // Vitrine 3D (o modelo vem do R2)
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
  await expect(page.getByTestId('contagem-filtro')).toHaveText('7 de 7 unidades');
  await page.screenshot({ path: test.info().outputPath('vitrine-no-ar.png') });

  // configurador: telhado separado pelo conversor do Render, troca de acabamento com o modelo do R2
  await page.goto('/painel/catalogo');
  await page.getByRole('button', { name: 'Adicionar catálogo inicial' }).click();
  await expect(page.getByText(/19 materiais e 16 móveis adicionados/)).toBeVisible();
  await page.goto(projetoUrl);
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByRole('link', { name: 'Configurador' }).click();
  const tela = page.getByTestId('configurador-3d');
  await expect(tela).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
  await expect(page.getByLabel('Acabamento: Telhado')).toBeVisible();
  const paredes = page.getByLabel('Acabamento: Paredes');
  await paredes.selectOption((await paredes.locator('option').filter({ hasText: 'Tijolinho aparente' }).getAttribute('value'))!);
  await expect(tela).toHaveAttribute('data-trocas', '1');
  expect(Number(await tela.getAttribute('data-troca-trabalho-ms'))).toBeLessThan(20);
  await tela.screenshot({ path: test.info().outputPath('configurador-no-ar.png') });

  // link para o cliente
  await page.goto(projetoUrl);
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByLabel('Para quem (opcional)').fill('Cliente Teste');
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const link = (await page.getByTestId('link-cliente').textContent())!.trim();
  expect(link.startsWith(`${SITE}/v/`)).toBe(true);
  const html = await (await request.get(link)).text();
  expect(html).toContain('<meta property="og:title" content="Casa FZK · Casa em 3D"');

  // cliente no celular, sem login
  const celular = await browser.newContext({ ...devices['Pixel 7'] });
  const cliente = await celular.newPage();
  await cliente.goto(link);
  await expect(cliente.getByRole('heading', { name: 'Casa FZK · Casa' })).toBeVisible();
  await expect(cliente.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
  await expect(cliente.getByTestId('vitrine-3d')).toHaveAttribute('data-ao-vivo', 'conectado', { timeout: 60_000 });
  await cliente.getByTestId('lista-vitrine').getByRole('button', { name: /^4/ }).tap();
  await expect(cliente.getByRole('heading', { name: 'Unidade 4' })).toBeVisible();
  await cliente.screenshot({ path: test.info().outputPath('portal-celular-no-ar.png') });
  await cliente.getByRole('link', { name: /Quero falar com/ }).tap();
  await cliente.getByLabel('Seu nome').fill('Cliente Teste');
  await cliente.getByLabel('WhatsApp ou telefone (com DDD)').fill('(11) 90000-0000');
  await cliente.getByRole('checkbox', { name: /Autorizo/ }).check();
  await cliente.getByRole('button', { name: 'Enviar pedido de contato' }).tap();
  await expect(cliente.getByText('Obrigado, Cliente!')).toBeVisible({ timeout: 60_000 });
  await celular.close();

  // lead no painel
  await page.goto('/painel/leads');
  await expect(page.getByTestId('lista-leads').getByRole('listitem').filter({ hasText: 'Cliente Teste' })).toContainText('unidade 4');
});
