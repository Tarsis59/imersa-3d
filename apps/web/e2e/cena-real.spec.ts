import { basename } from 'node:path';
import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

/**
 * 3D real treinado na GPU (Kaggle) aberto na Vitrine: envio, interior, giro de câmera e capturas de tela.
 * Só roda com E2E_CENA_REAL=<caminho do .sog/.spz> (o arquivo real tem dezenas de MB e não fica no repositório).
 */
const CENA = process.env.E2E_CENA_REAL;

test('cena real da GPU abre no interior da Vitrine', async ({ page, request }, info) => {
  test.skip(!CENA, 'defina E2E_CENA_REAL com o caminho do .sog gerado na GPU');
  test.setTimeout(600_000);
  const nome = basename(CENA!);
  await entrarComoAdminComMfa(page, request, `real-${info.project.name}`);
  await page.getByLabel('Nome do projeto').fill('Cena real');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Cena real/ }).click();
  await page.waitForLoadState('networkidle');

  await page.locator('#tipo-arquivo').selectOption({ label: 'Interior real (splat)' });
  await page.locator('#arquivo-envio').setInputFiles(CENA!);
  await page.getByRole('button', { name: 'Enviar arquivo' }).click();
  await expect(page.getByText(`${nome} enviado e verificado.`)).toBeVisible({ timeout: 180_000 });

  await page.getByLabel('Nome do prédio').fill('Casa');
  await page.getByLabel('Andares').fill('1');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Conteúdo da planilha').fill('predio;andar;codigo\nCasa;1;101');
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  await expect(page.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });

  await page.getByRole('button', { name: `Ver interior: ${nome}` }).click();
  const interior = page.getByTestId('interior');
  await expect(interior).toHaveAttribute('data-estado', 'pronto', { timeout: 300_000 });
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: info.outputPath('interior-1.png') });

  // arrasta para girar a câmera (o visitante "olha em volta" dentro do ambiente)
  const caixa = (await interior.boundingBox())!;
  const cx = caixa.x + caixa.width / 2;
  const cy = caixa.y + caixa.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + caixa.width / 4, cy, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: info.outputPath('interior-2.png') });
  await expect(interior).toHaveAttribute('data-estado', 'pronto');
});
