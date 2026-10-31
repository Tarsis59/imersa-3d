import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

/** Splat pequeno e válido (.splat: 32 bytes por ponto): uma esfera colorida de 2.000 pontos. */
function esferaSplat(n = 2000): Buffer {
  const b = Buffer.alloc(n * 32);
  for (let i = 0; i < n; i++) {
    const o = i * 32;
    const t = Math.acos(1 - (2 * (i + 0.5)) / n);
    const f = Math.PI * (1 + Math.sqrt(5)) * i;
    b.writeFloatLE(Math.sin(t) * Math.cos(f), o);
    b.writeFloatLE(Math.cos(t), o + 4);
    b.writeFloatLE(Math.sin(t) * Math.sin(f) - 3, o + 8);
    for (let k = 0; k < 3; k++) b.writeFloatLE(0.03, o + 12 + k * 4);
    b.writeUInt8(Math.round(127 + 127 * Math.sin(f)), o + 24);
    b.writeUInt8(Math.round(127 + 127 * Math.cos(t)), o + 25);
    b.writeUInt8(200, o + 26);
    b.writeUInt8(255, o + 27);
    b.writeUInt8(255, o + 28); // quatérnio identidade (w = 1)
    b.writeUInt8(128, o + 29);
    b.writeUInt8(128, o + 30);
    b.writeUInt8(128, o + 31);
  }
  return b;
}

const scripts = (page: import('@playwright/test').Page) =>
  page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /\.js(\?|$)/.test(r.name)).map((r) => r.name));

test('interior real (splat) abre sob demanda na Vitrine, sem pesar a carga inicial', async ({ page, request }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'interior');
  await page.getByLabel('Nome do projeto').fill('Casa com interior');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Casa com interior/ }).click();

  await page.locator('#tipo-arquivo').selectOption({ label: 'Interior real (splat)' });
  await page.locator('#arquivo-envio').setInputFiles({ name: 'sala-teste.splat', mimeType: 'application/octet-stream', buffer: esferaSplat() });
  await page.getByRole('button', { name: 'Enviar arquivo' }).click();
  await expect(page.getByText('sala-teste.splat enviado e verificado.')).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('Nome do prédio').fill('Casa');
  await page.getByLabel('Andares').fill('1');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill('predio;andar;codigo\nCasa;1;101');
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  await expect(page.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto', { timeout: 45_000 });

  const antes = new Set(await scripts(page));
  await page.getByRole('button', { name: 'Ver interior: sala-teste.splat' }).click();
  const interior = page.getByTestId('interior');
  await expect(interior).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  // a biblioteca de splats chegou só agora (carregamento sob demanda)
  const novos = (await scripts(page)).filter((s) => !antes.has(s));
  expect(novos.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Virar imagem' }).click();
  await page.getByRole('button', { name: '← Voltar ao prédio' }).click();
  await expect(interior).toHaveCount(0);
  await expect(page.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto');
});
