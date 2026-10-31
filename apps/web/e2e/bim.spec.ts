import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

// Casa FZK (IFC4): 2 pavimentos, 7 ambientes numerados de 1 a 7
const FZK = fileURLToPath(new URL('../../../exemplos/projeto-bim/AC20-FZK-Haus.ifc', import.meta.url));
const PLANILHA = ['predio;andar;codigo;status', ...[1, 2, 3, 4, 5, 6].map((n) => `Casa;1;${n};disponivel`), 'Casa;2;7;vendido'].join('\n');

test('BIM: IFC real → 3D otimizado com ambientes → vínculo automático com as unidades → Vitrine', async ({ page, request }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'bim');
  await page.getByLabel('Nome do projeto').fill('Casa FZK');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Casa FZK/ }).click();
  await page.getByLabel('Nome do prédio').fill('Casa');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();

  await page.locator('#tipo-arquivo').selectOption({ label: 'Projeto BIM (.ifc)' });
  await page.locator('#arquivo-envio').setInputFiles(FZK);
  await page.getByRole('button', { name: 'Enviar arquivo' }).click();
  await expect(page.getByText('AC20-FZK-Haus.ifc enviado e verificado.')).toBeVisible({ timeout: 60_000 });

  // conversão de verdade no worker (IfcOpenShell + gltf-transform)
  const item = page.getByTestId('lista-bim').getByRole('listitem').filter({ hasText: 'AC20-FZK-Haus.ifc' });
  await item.getByRole('button', { name: 'Converter para 3D' }).click();
  await expect(item).toHaveAttribute('data-status-bim', 'pronto', { timeout: 180_000 });
  await expect(item).toContainText('2 pavimentos · 7 ambientes');
  await expect(item).toContainText(/% menor/);

  // vínculo: os 7 códigos batem com os nomes dos ambientes (sugestão automática)
  await item.getByRole('link', { name: 'Vincular ambientes: Casa' }).click();
  await expect(page.getByText(/7 vínculos sugeridos/)).toBeVisible();
  await expect(page.getByLabel('Ambiente da unidade 4')).toContainText('4 · Schlafzimmer');
  await expect(page.getByLabel('Ambiente da unidade 7')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Salvar vínculos e usar este modelo' }).click();
  await expect(page.getByText('7 unidades vinculadas e modelo ligado ao prédio.')).toBeVisible();

  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await expect(page.getByTestId('contagem-filtro')).toHaveText('7 de 7 unidades');
  await page.getByTestId('lista-vitrine').getByRole('button', { name: /^4/ }).click();
  await expect(page.getByRole('heading', { name: 'Unidade 4' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('vitrine-bim.png') });
});
