import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { codigoTotp } from '../../api/src/auth/totp';

export const API = 'http://localhost:3334';

/** Registra uma empresa nova, entra pelo site e ativa o MFA. Termina no /painel com sessão de gestão completa. */
export async function entrarComoAdminComMfa(page: Page, request: APIRequestContext, prefixo: string) {
  const empresa = `${prefixo}-${Date.now().toString(36)}`;
  const email = `admin@${empresa}.com`;
  const senha = 'senha-forte-e2e-1';
  const reg = await request.post(`${API}/auth/registro`, { data: { empresa: { nome: `Construtora ${prefixo}`, slug: empresa }, nome: 'Admin E2E', email, senha } });
  expect(reg.status()).toBe(201);

  await page.goto('/login');
  await page.getByLabel('Empresa').fill(empresa);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/);

  await page.goto('/painel/seguranca');
  await page.getByRole('button', { name: 'Gerar código QR' }).click();
  const segredo = (await page.getByTestId('segredo-mfa').textContent())?.trim() ?? '';
  await page.getByLabel('Código de 6 dígitos').fill(codigoTotp(segredo));
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  return { empresa, email, senha, segredo };
}
