import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { entrarComoAdminComMfa } from './ajuda';

const PLANILHA = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre F;1;101;Tipo 2Q;70;2;610.000,00;disponivel', 'Torre F;2;201;Tipo 2Q;70;2;640.000,00;vendido', 'Torre F;3;301;Tipo 2Q;70;2;660.000,00;reservado'].join('\n');

test('foto fotorrealista: o path tracing revela na tela e sai o PNG com a marca; cancelar não baixa nada', async ({ page, request }) => {
  test.setTimeout(420_000);
  await entrarComoAdminComMfa(page, request, 'foto');
  await page.getByLabel('Nome do projeto').fill('Residencial Foto');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Foto/ }).click();
  await page.getByLabel('Nome do prédio').fill('Torre F');
  await page.getByLabel('Andares').fill('3');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });

  // cancelar no meio: volta ao 3D normal, sem baixar nada
  await page.goto(`${page.url()}?amostras=2000`);
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  let baixou = false;
  page.on('download', () => (baixou = true));
  await page.getByRole('button', { name: 'Foto fotorrealista (PNG)' }).click();
  const revelando = page.getByTestId('foto-revelando');
  await expect(revelando).toBeVisible();
  await expect(revelando).toContainText(/de 2000/);
  await revelando.getByRole('button', { name: 'Cancelar a foto' }).click();
  await expect(revelando).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Foto fotorrealista (PNG)' })).toBeEnabled();
  expect(baixou).toBe(false);

  // poucas amostras (o teste roda com o 3D desenhado por software; E2E_FOTO_AMOSTRAS para ver a qualidade de
  // verdade com placa de vídeo): a foto sai com a faixa da marca
  await page.goto(page.url().replace('amostras=2000', `amostras=${process.env.E2E_FOTO_AMOSTRAS ?? '3'}`));
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  const baixando = page.waitForEvent('download', { timeout: 300_000 });
  await page.getByRole('button', { name: 'Foto fotorrealista (PNG)' }).click();
  const arquivo = await baixando;
  expect(arquivo.suggestedFilename()).toMatch(/^torre-f-foto-\d{4}-\d{2}-\d{2}\.png$/);
  await arquivo.saveAs(test.info().outputPath('foto-fotorrealista.png')); // para revisão
  const bytes = await readFile((await arquivo.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  // a imagem tem conteúdo (não é preta nem de uma cor só) e a faixa da marca embaixo
  const analise = await page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, Math.floor(img.height * 0.8)).data;
    let soma = 0;
    let soma2 = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      soma += l;
      soma2 += l * l;
    }
    const media = soma / n;
    const faixa = ctx.getImageData(2, img.height - 4, 1, 1).data;
    return { largura: img.width, altura: img.height, media, desvio: Math.sqrt(soma2 / n - media * media), faixa: [faixa[0], faixa[1], faixa[2]] };
  }, bytes.toString('base64'));
  expect(analise.media).toBeGreaterThan(20); // não ficou preta
  expect(analise.desvio).toBeGreaterThan(8); // tem prédio, céu e chão (não é uma cor só)
  expect(analise.altura).toBeGreaterThan(analise.largura * 0.3);
  expect(analise.faixa).toEqual([15, 23, 42]); // faixa da marca (#0f172a)
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto'); // o 3D voltou a desenhar
});
