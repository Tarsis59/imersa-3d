import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { entrarComoAdminComMfa } from './ajuda';

const CASA = fileURLToPath(new URL('./fixtures/casa-fzk.glb', import.meta.url));

test('arquivos e 3D: envia GLB real, recusa GLB falso, liga ao prédio e vincula peça à unidade', async ({ page, request }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'tresd');

  await page.getByLabel('Nome do projeto').fill('Casa FZK');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Casa FZK/ }).click();

  // envio do modelo real (casa BIM convertida de IFC, 107 peças)
  await page.locator('#arquivo-envio').setInputFiles(CASA);
  await page.getByRole('button', { name: 'Enviar arquivo' }).click();
  await expect(page.getByText('casa-fzk.glb enviado e verificado.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('lista-arquivos').locator('[data-status-arquivo="pronto"]')).toHaveCount(1);

  // arquivo com extensão .glb mas conteúdo de executável é recusado
  await page.locator('#arquivo-envio').setInputFiles({ name: 'falso.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('MZ isto não é um modelo 3D') });
  await page.getByRole('button', { name: 'Enviar arquivo' }).click();
  await expect(page.getByText('o conteúdo não corresponde ao tipo do arquivo').first()).toBeVisible({ timeout: 30_000 });

  // prédio + unidades
  await page.getByLabel('Nome do prédio').fill('Casa');
  await page.getByLabel('Andares').fill('1');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill('predio;andar;codigo\nCasa;1;101\nCasa;1;102');
  await page.getByRole('button', { name: 'Prévia' }).click();
  await expect(page.getByText('Prévia (nada foi gravado).')).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();

  // modelo 3D do prédio
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByLabel('Modelo 3D do prédio').selectOption({ label: 'casa-fzk.glb' });
  await page.getByRole('button', { name: 'Salvar modelo' }).click();
  await expect(page.getByText('Modelo 3D ligado ao prédio.')).toBeVisible();

  // vínculo no 3D
  await page.getByRole('link', { name: 'Abrir no 3D e ligar peças às unidades' }).click();
  const visualizador = page.getByTestId('visualizador-3d');
  await expect(visualizador).toHaveAttribute('data-estado', 'pronto', { timeout: 45_000 });
  await visualizador.locator('canvas').click();
  await expect(page.getByTestId('peca-selecionada')).toHaveText(/^product-[0-9a-f-]+-body$/);
  await page.getByLabel('Unidade').selectOption({ label: '101 · 1º andar' });
  await page.getByRole('button', { name: 'Ligar à unidade' }).click();
  await expect(page.getByTestId('vinculo-atual')).toContainText('Ligada à unidade 101', { timeout: 30_000 });
  // o modelo NÃO é recarregado depois do vínculo (continua pronto, sem piscar)
  await expect(visualizador).toHaveAttribute('data-estado', 'pronto');
});
