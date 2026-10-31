import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { entrarComoAdminComMfa } from './ajuda';

// casa BIM real comprimida pela ferramenta do pacote viewer (gltf-transform): 531 KB → 154 KB (Meshopt) / 135 KB (Draco)
const CASA = fileURLToPath(new URL('./fixtures/casa-fzk-meshopt.glb', import.meta.url));
const CASA_DRACO = fileURLToPath(new URL('./fixtures/casa-fzk-draco.glb', import.meta.url));

test('arquivos e 3D: envia GLB real, recusa GLB falso, liga ao prédio e vincula peça à unidade', async ({ page, request }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'tresd');

  await page.getByLabel('Nome do projeto').fill('Casa FZK');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Casa FZK/ }).click();

  // envio do modelo real (casa BIM convertida de IFC, 107 peças, comprimida sem perder os nomes)
  await page.locator('#arquivo-envio').setInputFiles(CASA);
  await page.getByRole('button', { name: 'Enviar arquivo' }).click();
  await expect(page.getByText('casa-fzk-meshopt.glb enviado e verificado.')).toBeVisible({ timeout: 30_000 });
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
  await page.getByLabel('Modelo 3D do prédio').selectOption({ label: 'casa-fzk-meshopt.glb' });
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

  // vitrine com o modelo real: a peça ligada é a unidade 101; só o andar dela tem corte
  await page.getByRole('link', { name: '← Casa' }).click();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 45_000 });
  await expect(page.getByText('as peças ligadas às unidades aparecem na cor do status')).toBeVisible();
  await page.getByTestId('lista-vitrine').getByRole('button', { name: /^101/ }).click();
  await expect(page.getByRole('heading', { name: 'Unidade 101' })).toBeVisible();
  await expect(page.getByLabel('Ver até o andar (corte)').locator('option')).toHaveText(['Prédio inteiro', '1º andar']);
  await page.getByLabel('Ver até o andar (corte)').selectOption({ label: '1º andar' });
  await expect(vitrine).toHaveAttribute('data-corte', '1');
  // primeira pessoa com colisão pelas paredes reais do modelo (raio contra as malhas)
  await page.getByRole('button', { name: 'Andar a pé (1ª pessoa)' }).click();
  await expect(vitrine).toHaveAttribute('data-modo', 'primeira-pessoa');

  // a mesma casa em Draco (formato comum de quem exporta do Blender/Revit) também abre e as peças continuam clicáveis
  await page.getByRole('link', { name: '← Casa' }).click();
  await page.getByRole('link', { name: '← Casa FZK' }).click();
  await page.locator('#arquivo-envio').setInputFiles(CASA_DRACO);
  await page.getByRole('button', { name: 'Enviar arquivo' }).click();
  await expect(page.getByText('casa-fzk-draco.glb enviado e verificado.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByLabel('Modelo 3D do prédio').selectOption({ label: 'casa-fzk-draco.glb' });
  await page.getByRole('button', { name: 'Salvar modelo' }).click();
  await expect(page.getByText('Modelo 3D ligado ao prédio.')).toBeVisible();
  await page.getByRole('link', { name: 'Abrir no 3D e ligar peças às unidades' }).click();
  await expect(visualizador).toHaveAttribute('data-estado', 'pronto', { timeout: 45_000 });
  await visualizador.locator('canvas').click();
  await expect(page.getByTestId('peca-selecionada')).toHaveText(/^product-[0-9a-f-]+-body$/);
});
