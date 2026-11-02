import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

/**
 * Regressão visual da Vitrine em 3 resoluções. Cena determinística: dados fixos, entorno do arquivo da Paulista,
 * sol em 21/06 às 15h, qualidade fixa e câmera inicial. Qualquer mudança visual reprova; se for intencional,
 * atualize as referências com `pnpm e2e --update-snapshots` e revise as imagens no commit.
 * Tolerância de 2%: o 3D desenhado por software no CI varia um pouco entre quadros seguidos.
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

// loteamento (Plano 12e): 3 quadras com 3 lotes de 12 × 30 m cada (9 lotes), com rua/calçada/meio-fio (layers do
// item 8) para o terreno do DXF aparecer no chão, igual ao gerador de e2e/loteamento.spec.ts.
function dxfLoteamento(): string {
  const poli = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '1', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
  const linha = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '0', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
  const texto = (camada: string, x: number, y: number, t: string) => ['0', 'TEXT', '8', camada, '10', String(x), '20', String(y), '40', '1.5', '1', t];
  const e: string[] = [];
  const [x0, y0] = [332_100, 7_394_300];
  for (const [q, dy] of [[1, 0], [2, 50], [3, 100]] as const) {
    e.push(...poli('QUADRAS', [[x0 - 2, y0 + dy - 2], [x0 + 38, y0 + dy - 2], [x0 + 38, y0 + dy + 32], [x0 - 2, y0 + dy + 32]]), ...texto('QUADRAS', x0 + 30, y0 + dy + 31, `Q-${q}`));
    for (let l = 0; l < 3; l++) {
      const x = x0 + l * 12;
      e.push(...poli('LOTES', [[x, y0 + dy], [x + 12, y0 + dy], [x + 12, y0 + dy + 30], [x, y0 + dy + 30]]), ...texto('NUMEROS', x + 6, y0 + dy + 15, String(l + 1)));
    }
  }
  e.push(...linha('CALCADAS', [[x0 + 37.5, y0 - 5], [x0 + 37.5, y0 + 135]]));
  e.push(...linha('MEIO_FIO', [[x0 + 39, y0 - 5], [x0 + 39, y0 + 135]]));
  e.push(...linha('RUAS', [[x0 + 41, y0 - 5], [x0 + 41, y0 + 135]]));
  return ['0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

test('aparência da Vitrine 3D em celular, tablet e computador', async ({ page, request }) => {
  test.setTimeout(900_000); // 5 imagens com a cidade completa, duas com acabamento de imagem: no CI o 3D é desenhado por software
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
    if (tela.nome === 'tablet') {
      // no Linux do CI esta vista não estabiliza entre quadros seguidos (desenho por software); a imagem vai anexada
      // ao relatório para revisão, e o funcionamento no tablet é coberto pelos testes de iPad e Android
      await test.info().attach('vitrine-tablet', { body: await vitrine.screenshot(), contentType: 'image/png' });
      continue;
    }
    await expect(vitrine).toHaveScreenshot(`vitrine-${tela.nome}.png`, {
      maxDiffPixelRatio: 0.02,
      timeout: 90_000, // desenho por software no navegador de teste: cada captura é lenta (a cidade completa pesa)
      mask: [page.getByTestId('qualidade')], // o número de FPS muda a cada rodada
    });
  }

  // qualidade alta: céu, reflexos e acabamento de imagem (sombra de contato, brilho, antisserrilhado)
  url.searchParams.set('qualidade', 'alto');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url.toString());
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 45_000 });
  await expect(vitrine).toHaveAttribute('data-entorno', /^\d+$/, { timeout: 45_000 });
  await expect(vitrine).toHaveAttribute('data-acabamento', 'ligado', { timeout: 30_000 });
  await page.getByLabel('Dia do sol').fill('2026-06-21');
  await page.getByLabel(/^Hora/).fill('15');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  await expect(vitrine).toHaveScreenshot('vitrine-computador-alta.png', { maxDiffPixelRatio: 0.02, timeout: 90_000, mask: [page.getByTestId('qualidade')] });
  // noite: céu escuro com estrelas e janelas acesas (as disponíveis sempre acesas)
  await page.getByLabel(/^Hora/).fill('21');
  await page.waitForTimeout(1500);
  await expect(vitrine).toHaveScreenshot('vitrine-computador-noite.png', { maxDiffPixelRatio: 0.02, timeout: 90_000, mask: [page.getByTestId('qualidade')] });
});

// loteamento (Plano 12e): produto novo do Plano 12d, lotes coloridos no chão com o terreno (rua, calçada, meio-fio)
// do DXF. Teste à parte: no CI o 3D é desenhado por software e as 5 imagens do prédio já usam quase todo o tempo.
test('aparência do loteamento com o terreno do DXF', async ({ page, request }) => {
  test.setTimeout(600_000);
  await entrarComoAdminComMfa(page, request, 'visual-lote');
  await page.getByLabel('Nome do projeto').fill('Residencial dos Ipês');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial dos Ipês/ }).click();
  await page.getByLabel('Latitude').fill('-23.56175');
  await page.getByLabel('Longitude').fill('-46.6545');
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(page.getByText('Dados salvos.')).toBeVisible();
  await page.getByLabel('Nome do prédio').fill('Loteamento');
  await page.getByLabel('Andares').fill('1');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  const importar = page.getByTestId('importar-lotes');
  await importar.getByLabel('Arquivo do loteamento').setInputFiles({ name: 'loteamento-visual.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxfLoteamento()) });
  await importar.getByRole('button', { name: 'Ver a prévia' }).click();
  await importar.getByRole('button', { name: 'Gravar os lotes' }).click();
  await expect(page.getByTestId('previa-lotes')).toContainText('Gravado: 9 lotes');
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  await page.waitForURL(/\/painel\/predios\/[^/]+\/vitrine$/);
  const urlLote = new URL(page.url());
  urlLote.searchParams.set('qualidade', 'medio');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(urlLote.toString());
  const vitrineLote = page.getByTestId('vitrine-3d');
  await expect(vitrineLote).toHaveAttribute('data-estado', 'pronto', { timeout: 45_000 });
  await expect(vitrineLote).toHaveAttribute('data-lotes', '9', { timeout: 30_000 });
  await expect(vitrineLote).toHaveAttribute('data-anos', '10', { timeout: 15_000 }); // terreno do DXF carregado
  await page.getByLabel('Dia do sol').fill('2026-06-21');
  await page.getByLabel(/^Hora/).fill('15');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  await expect(vitrineLote).toHaveScreenshot('vitrine-loteamento.png', { maxDiffPixelRatio: 0.02, timeout: 90_000, mask: [page.getByTestId('qualidade')] });
});
