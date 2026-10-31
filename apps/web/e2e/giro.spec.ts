import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

test('giro 360° (modo leve): gera 72 imagens, arrastar gira, setas giram e tocar abre a unidade', async ({ page, request }) => {
  test.setTimeout(400_000);
  await entrarComoAdminComMfa(page, request, 'giro');
  await page.getByLabel('Nome do projeto').fill('Residencial Giro');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Giro/ }).click();
  await page.getByLabel('Nome do prédio').fill('Torre G');
  await page.getByLabel('Andares').fill('3');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  const linhas = ['predio;andar;codigo;status'];
  for (let a = 1; a <= 3; a++) for (let f = 1; f <= 4; f++) linhas.push(`Torre G;${a};${a}0${f};${f === 3 ? 'vendido' : 'disponivel'}`);
  await page.getByLabel('Conteúdo da planilha').fill(linhas.join('\n'));
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 45_000 });

  await page.getByRole('button', { name: 'Gerar giro 360° (modo leve)' }).click();
  await expect(vitrine).toHaveAttribute('data-giro', 'gerando');
  await expect(vitrine).toHaveAttribute('data-giro', 'pronto', { timeout: 240_000 });
  const giro = page.getByTestId('giro');
  await expect(giro).toHaveAttribute('data-quadro', '0');
  // a imagem do quadro carregou de verdade (não só a máscara)
  const imagemCarregada = () => giro.locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0);
  await expect.poll(imagemCarregada).toBe(true);

  // arrastar um quarto da largura para a esquerda = um quarto de volta (18 de 72)
  const area = giro.getByRole('slider');
  const caixa = (await area.boundingBox())!;
  const meioY = caixa.y + caixa.height / 2;
  await page.mouse.move(caixa.x + caixa.width * 0.6, meioY);
  await page.mouse.down();
  await page.mouse.move(caixa.x + caixa.width * 0.45, meioY, { steps: 5 });
  await page.mouse.move(caixa.x + caixa.width * 0.35, meioY, { steps: 5 });
  await page.mouse.up();
  await expect(giro).toHaveAttribute('data-quadro', '18');
  await area.focus();
  await page.keyboard.press('ArrowRight');
  await expect(giro).toHaveAttribute('data-quadro', '19');

  // tocar no prédio: a cor da máscara diz qual unidade é (procura um ponto fora das frestas entre unidades)
  const cartao = page.getByTestId('unidade-selecionada');
  for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.45], [0.55, 0.55], [0.45, 0.6], [0.55, 0.4], [0.4, 0.5], [0.6, 0.5]] as const) {
    await page.mouse.click(caixa.x + caixa.width * fx, caixa.y + caixa.height * fy);
    if (await cartao.isVisible().catch(() => false)) break;
    await page.waitForTimeout(300);
  }
  await expect(cartao).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Unidade \d0\d$/ })).toBeVisible();

  // fechar volta ao 3D; abrir de novo não gera de novo
  await page.getByRole('button', { name: '← Voltar ao 3D' }).click();
  await expect(giro).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir giro 360° (modo leve)' }).click();
  await expect(giro).toHaveAttribute('data-quadro', '19');
  await expect.poll(imagemCarregada).toBe(true);
});
