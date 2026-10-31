import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

/**
 * Tablets: roda nos projetos "ipad" (WebKit = motor do Safari, iPad Pro 11) e "tablet-android" (Galaxy Tab S4).
 * Toque de verdade (tap), tela de tablet em pé e na horizontal, Vitrine 3D, filtro, cartão e primeira pessoa.
 */
const PLANILHA = [
  'predio;andar;codigo;tipologia;area_m2;quartos;preco;status',
  ...[1, 2, 3].flatMap((a) => [1, 2, 3, 4].map((f) => `Torre T;${a};${a}0${f};Tipo ${f % 2 ? 2 : 3}Q;${f % 2 ? 70 : 98};${f % 2 ? 2 : 3};${600 + a * 10 + f}.000,00;${f === 3 ? 'vendido' : 'disponivel'}`)),
].join('\n');

test('tablet: Vitrine 3D com toque, em pé e deitado', async ({ page, request }, info) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, `tab-${info.project.name}`);
  await page.getByLabel('Nome do projeto').fill('Residencial Tablet');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Tablet/ }).click();
  // WebKit: espera os scripts da página assumirem os campos (hidratação) antes de digitar
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Nome do prédio').fill('Torre T');
  await page.getByLabel('Andares').fill('3');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: /ver espelho de vendas/ }).tap();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).tap();

  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  // nada passa da largura da tela (sem rolagem lateral)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('vitrine-em-pe.png') });

  // toque: filtro, unidade e cartão
  await page.getByLabel('3 quartos').tap();
  await expect(page.getByTestId('contagem-filtro')).toHaveText('6 de 12 unidades');
  await page.getByTestId('lista-vitrine').getByRole('button', { name: /^202/ }).tap();
  await expect(page.getByRole('heading', { name: 'Unidade 202' })).toBeVisible();
  await expect(page.getByTestId('unidade-selecionada')).toContainText('98 m²');

  // primeira pessoa com o joystick de toque
  await page.getByRole('button', { name: 'Andar a pé (1ª pessoa)' }).tap();
  await expect(vitrine).toHaveAttribute('data-modo', 'primeira-pessoa');
  const joystick = page.getByTestId('joystick');
  await expect(joystick).toBeVisible();
  const caixa = (await joystick.boundingBox())!;
  expect(caixa.width).toBeGreaterThanOrEqual(44); // alvo de toque confortável

  // deitado (paisagem): continua sem rolagem lateral e o 3D continua na tela
  const v = page.viewportSize()!;
  await page.setViewportSize({ width: v.height, height: v.width });
  await expect(vitrine).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('vitrine-deitado.png') });
});
