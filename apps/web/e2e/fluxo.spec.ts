import { test, expect } from '@playwright/test';
import { codigoTotp } from '../../api/src/auth/totp';

const API = 'http://localhost:3334';

test('rota protegida sem sessão vai para o login', async ({ page }) => {
  await page.goto('/painel');
  await expect(page).toHaveURL(/\/login/);
});

test('fluxo completo: registro, login, MFA, projeto, convite, consultora, sair', async ({ page, browser, request }) => {
  const sufixo = Date.now().toString(36);
  const empresa = `e2e-${sufixo}`;
  const email = `admin-${sufixo}@teste.com`;
  const senha = 'senha-forte-e2e-1';

  const reg = await request.post(`${API}/auth/registro`, { data: { empresa: { nome: 'Construtora E2E', slug: empresa }, nome: 'Admin E2E', email, senha } });
  expect(reg.status()).toBe(201);

  // login
  await page.goto('/login');
  await page.getByLabel('Empresa').fill(empresa);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByText('Ative a verificação em duas etapas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar projeto' })).toHaveCount(0);

  // MFA
  await page.getByRole('link', { name: 'Ativar agora' }).click();
  await page.getByRole('button', { name: 'Gerar código QR' }).click();
  const segredo = (await page.getByTestId('segredo-mfa').textContent())?.trim() ?? '';
  expect(segredo).toMatch(/^[A-Z2-7]{32}$/);
  await expect(page.getByAltText('Código QR para o aplicativo autenticador')).toBeVisible();
  await page.getByLabel('Código de 6 dígitos').fill(codigoTotp(segredo));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page).toHaveURL(/\/painel$/);

  // projeto
  await page.getByLabel('Nome do projeto').fill('Residencial Paulista E2E');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await expect(page.getByTestId('lista-projetos')).toContainText('Residencial Paulista E2E');

  // convite
  await page.getByRole('link', { name: 'Membros' }).click();
  const emailC = `consultora-${sufixo}@teste.com`;
  await page.getByLabel('E-mail da pessoa').fill(emailC);
  await page.getByLabel('Papel').selectOption('consultora');
  await page.getByRole('button', { name: 'Gerar convite' }).click();
  const link = (await page.getByTestId('link-convite').textContent())?.trim() ?? '';
  expect(link).toContain('http://localhost:3100/convite/');

  // consultora aceita em outro navegador
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(link);
  await p2.getByLabel('Seu nome').fill('Consultora E2E');
  await p2.getByLabel('Crie uma senha').fill('senha-consultora-1');
  await p2.getByRole('button', { name: 'Aceitar convite' }).click();
  await expect(p2).toHaveURL(/\/login\?empresa=/);
  await expect(p2.getByLabel('Empresa')).toHaveValue(empresa);
  await p2.getByLabel('E-mail').fill(emailC);
  await p2.getByLabel('Senha').fill('senha-consultora-1');
  await p2.getByRole('button', { name: 'Entrar' }).click();
  await expect(p2.getByTestId('lista-projetos')).toContainText('Residencial Paulista E2E');
  await expect(p2.getByRole('button', { name: 'Criar projeto' })).toHaveCount(0);
  await p2.goto('/painel/membros');
  // (o Next também tem um role="alert" invisível — o anunciador de rota — então busca pelo texto)
  await expect(p2.getByText('Seu papel não permite esta ação.')).toBeVisible();
  await ctx.close();

  // o convite não pode ser reutilizado
  await page.goto(link);
  await expect(page.getByText('Convite inválido')).toBeVisible();

  // sair
  await page.goto('/painel');
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/painel');
  await expect(page).toHaveURL(/\/login/);
});
