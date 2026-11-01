import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

// Planta do térreo da casa FZK desenhada a partir do IFC real (servicos/bim/tests/planta_fzk.py): 12 m de largura
// entre as faces externas, com a cota "12.00" desenhada de x = 100 a x = 700 px, na altura y = 50 px
const PLANTA = fileURLToPath(new URL('../../../exemplos/projeto-bim/planta-fzk-terreo.png', import.meta.url));

test('planta: PNG → paredes, portas e janelas detectadas → escala e ajuste no editor → 3D do prédio → configurador', async ({ page, request }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'planta');
  await page.getByLabel('Nome do projeto').fill('Casa pela planta');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Casa pela planta/ }).click();
  await page.getByLabel('Nome do prédio').fill('Casa');
  await page.getByLabel('Andares').fill('1');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  const projetoUrl = page.url();

  await page.locator('#tipo-arquivo').selectOption({ label: 'Planta' });
  await page.locator('#arquivo-envio').setInputFiles(PLANTA);
  await page.getByRole('button', { name: 'Enviar arquivo' }).click();
  await expect(page.getByText('planta-fzk-terreo.png enviado e verificado.')).toBeVisible({ timeout: 60_000 });

  // leitura de verdade no worker (OpenCV)
  const item = page.getByTestId('lista-plantas').getByRole('listitem').filter({ hasText: 'planta-fzk-terreo.png' });
  await item.getByRole('button', { name: 'Ler planta' }).click();
  await expect(item).toHaveAttribute('data-status-planta', 'pronto', { timeout: 120_000 });
  await expect(item).toContainText('15 portas, janelas e passagens · 4 cômodos');
  await item.getByRole('link', { name: 'Abrir editor: planta-fzk-terreo.png' }).click();

  // 1ª visita à página (o servidor de desenvolvimento compila a rota na hora)
  await expect(page).toHaveURL(/\/painel\/plantas\//, { timeout: 60_000 });
  const editor = page.getByTestId('editor-planta');
  await expect(editor).toHaveAttribute('data-aberturas', '15', { timeout: 60_000 });
  expect(Number(await editor.getAttribute('data-paredes'))).toBeGreaterThan(10);
  await expect(editor.locator('line[data-tipo="porta"]')).toHaveCount(5);
  await expect(editor.locator('line[data-tipo="janela"]')).toHaveCount(9);

  // sem escala, não gera 3D
  await page.getByRole('button', { name: 'Gerar 3D' }).click();
  await expect(page.getByText(/Defina a escala primeiro/)).toBeVisible();

  // escala pela cota de 12 m
  // posição da planta na tela medida na hora (as instruções da ferramenta aparecem acima e empurram o desenho)
  const clicarNaPlanta = async (x: number, y: number) => {
    const caixa = (await editor.boundingBox())!;
    // posição relativa ao desenho: o Playwright rola até ele antes de clicar
    await editor.click({ position: { x: (x / 800) * caixa.width, y: (y / 700) * caixa.height } });
  };
  await page.getByRole('button', { name: 'Marcar medida (escala)' }).click();
  await expect(page.getByText('Clique no início de uma medida conhecida (uma cota).')).toBeVisible();
  await clicarNaPlanta(100, 50);
  await expect(page.getByText('Agora clique no fim.')).toBeVisible();
  await clicarNaPlanta(700, 50);
  await page.getByLabel('Comprimento real (m)').fill('12');
  await page.getByRole('button', { name: 'Aplicar escala' }).click();
  await expect(page.getByTestId('escala-planta')).toContainText('1 m = 50.0 px');
  expect(Number(await editor.getAttribute('data-escala'))).toBeCloseTo(0.02, 3);

  // ajuste: uma porta a mais na parede da cozinha (x ≈ 290 px, parede horizontal em y ≈ 395 px)
  await page.getByRole('button', { name: 'Pôr porta' }).click();
  await clicarNaPlanta(200, 395);
  await expect(editor).toHaveAttribute('data-aberturas', '16');
  // e apaga de novo pelo teclado
  await page.getByRole('button', { name: 'Selecionar' }).click();
  await editor.locator('line[data-tipo="porta"]').last().click({ force: true });
  await page.keyboard.press('Delete');
  await expect(editor).toHaveAttribute('data-aberturas', '15');

  // 3D: prévia e geração ligada ao prédio
  await page.getByRole('button', { name: 'Ver em 3D' }).click();
  await expect(page.getByTestId('previa-planta-3d')).toBeVisible();
  await page.getByLabel('Usar como modelo do prédio').selectOption({ label: 'Casa' });
  await page.getByRole('button', { name: 'Gerar 3D' }).click();
  await expect(page.getByText('3D gerado e ligado ao prédio Casa.')).toBeVisible({ timeout: 60_000 });

  // o 3D da planta funciona como um BIM no configurador
  await page.getByRole('link', { name: 'Abrir Configurador' }).click();
  const tela = page.getByTestId('configurador-3d');
  await expect(tela).toHaveAttribute('data-estado', 'pronto', { timeout: 90_000 });
  await expect(page.getByLabel('Acabamento: Paredes')).toBeVisible();
  await expect(page.getByLabel('Acabamento: Pisos e lajes')).toBeVisible();
  await expect(page.getByLabel('Acabamento: Portas e janelas')).toBeVisible();
  // o piso tem a área do retângulo da casa (~12 × 10 m pelas faces externas)
  const rotuloPiso = await page.locator('label[for="superficie-pisos"]').textContent();
  const area = Number(rotuloPiso!.match(/([\d.,]+) m²/)![1]!.replace('.', '').replace(',', '.'));
  expect(area).toBeGreaterThan(100);
  expect(area).toBeLessThan(140);
  await tela.screenshot({ path: test.info().outputPath('planta-3d.png') });

  // a lista no projeto mostra a planta conferida e com 3D
  await page.goto(projetoUrl);
  await expect(page.getByTestId('lista-plantas')).toContainText('conferida · 3D gerado');
});
