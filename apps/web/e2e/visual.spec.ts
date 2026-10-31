import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

/**
 * Regressão visual da Vitrine em 3 resoluções. Cena determinística: dados fixos, entorno do arquivo da Paulista,
 * sol em 21/06 às 15h, qualidade fixa e câmera inicial. Qualquer mudança visual reprova; se for intencional,
 * atualize as referências com `pnpm e2e --update-snapshots` e revise as imagens no commit.
 * As referências dependem do sistema (o nome do arquivo leva -win32/-linux): no CI, gerar as do Linux uma vez.
 */
const TELAS = [
  { nome: 'celular', width: 390, height: 844 },
  { nome: 'tablet', width: 820, height: 1180 },
  { nome: 'computador', width: 1440, height: 900 },
];
const ST = ['disponivel', 'disponivel', 'reservado', 'vendido', 'bloqueado'];
const linhas = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status'];
for (let a = 1; a <= 10; a++) for (let f = 1; f <= 4; f++) linhas.push(`Torre A;${a};${a}0${f};Tipo ${f % 2 ? 2 : 3}Q;${f % 2 ? 70 : 98};${f % 2 ? 2 : 3};${600 + a * 10 + f}.000,00;${ST[(a + f) % 5]}`);

test('aparência da Vitrine 3D em celular, tablet e computador', async ({ page, request }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'visual');
  await page.getByLabel('Nome do projeto').fill('Residencial Paulista');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Paulista/ }).click();
  await page.getByLabel('Latitude').fill('-23.56175');
  await page.getByLabel('Longitude').fill('-46.6545');
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(page.getByText('Dados salvos.')).toBeVisible();
  await page.getByLabel('Nome do prédio').fill('Torre A');
  await page.getByLabel('Andares').fill('10');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(linhas.join('\n'));
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.waitForURL(/\/painel\/predios\/[^/]+$/);
  const url = new URL(page.url());
  url.pathname += '/vitrine';
  url.searchParams.set('qualidade', 'medio');

  for (const tela of TELAS) {
    await page.setViewportSize({ width: tela.width, height: tela.height });
    await page.goto(url.toString());
    const vitrine = page.getByTestId('vitrine-3d');
    await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 45_000 });
    await expect(vitrine).toHaveAttribute('data-entorno', /^\d+$/, { timeout: 45_000 });
    await page.getByLabel('Dia do sol').fill('2026-06-21');
    await page.getByLabel(/^Hora/).fill('15');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500); // sombras em cascata assentam
    await expect(vitrine).toHaveScreenshot(`vitrine-${tela.nome}.png`, {
      maxDiffPixelRatio: 0.01,
      timeout: 30_000, // desenho por software no navegador de teste: cada captura é lenta
      mask: [page.getByTestId('qualidade')], // o número de FPS muda a cada rodada
    });
  }
});
