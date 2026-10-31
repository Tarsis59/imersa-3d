import { test, expect } from '@playwright/test';
import { zipSync } from 'fflate';
import { entrarComoAdminComMfa } from './ajuda';

/** ZIP pequeno e válido como o do celular (o worker dos testes usa o reconstrutor simulado: não precisa de GPU). */
const zipDeFotos = () => Buffer.from(zipSync({ 'sala/IMG_0001.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'sala/IMG_0002.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]) }));

test('captura: envia fotos (ZIP) → fila → worker → revisão com prévia 3D → publica → aparece na Vitrine', async ({ page, request }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'captura');
  await page.getByLabel('Nome do projeto').fill('Apartamento real');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Apartamento real/ }).click();
  await page.getByLabel('Nome do prédio').fill('Torre C');
  await page.getByLabel('Andares').fill('1');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill('predio;andar;codigo\nTorre C;1;101');
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();

  // envio
  await expect(page.getByText('Como capturar (2 a 5 minutos por ambiente)')).toBeVisible();
  await page.getByLabel('Ambiente').fill('Sala do 101');
  await page.locator('#captura-envio').setInputFiles({ name: 'fotos-sala.zip', mimeType: 'application/zip', buffer: zipDeFotos() });
  await page.getByRole('button', { name: 'Enviar para 3D' }).click();
  await expect(page.getByText('Sala do 101: enviado.')).toBeVisible({ timeout: 30_000 });

  // o worker processa (a lista se atualiza sozinha; aqui recarregamos para não esperar 15 s)
  const item = page.getByTestId('lista-capturas').getByRole('listitem').filter({ hasText: 'Sala do 101' });
  await expect
    .poll(
      async () => {
        await page.reload();
        return item.getAttribute('data-status-captura');
      },
      { timeout: 60_000, intervals: [2_000] },
    )
    .toBe('revisao');
  // antes de publicar, o 3D não aparece como arquivo do projeto
  await expect(page.getByTestId('lista-arquivos').getByText('Sala do 101.sog')).toHaveCount(0);

  // revisão: prévia 3D e publicação
  await item.getByRole('link', { name: 'Revisar e publicar' }).click();
  await expect(page.getByTestId('previa-captura')).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Publicar na Vitrine' }).click();
  await expect(page.getByTestId('status-captura')).toContainText('Publicada');

  // na Vitrine do prédio, o interior publicado abre
  await page.getByRole('link', { name: '← Projeto' }).click();
  await expect(page.getByTestId('lista-arquivos').getByText('Sala do 101.sog')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  await expect(page.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto', { timeout: 45_000 });
  await page.getByRole('button', { name: 'Ver interior: Sala do 101.sog' }).click();
  await expect(page.getByTestId('interior')).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
});
