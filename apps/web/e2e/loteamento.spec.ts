import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

// DXF do parcelamento como o AutoCAD exporta: 2 quadras (layer QUADRAS, "Q-01" dentro) com 3 lotes de 12 × 30 m
// (layer LOTES, o número dentro), em UTM SIRGAS 2000 fuso 23, perto da Paulista
const poli = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '1', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
const texto = (camada: string, x: number, y: number, t: string) => ['0', 'TEXT', '8', camada, '10', String(x), '20', String(y), '40', '1.5', '1', t];
function dxf(): string {
  const e: string[] = [];
  const [x0, y0] = [332_100, 7_394_300];
  for (const [q, dy] of [[1, 0], [2, 50]] as const) {
    e.push(...poli('QUADRAS', [[x0 - 2, y0 + dy - 2], [x0 + 38, y0 + dy - 2], [x0 + 38, y0 + dy + 32], [x0 - 2, y0 + dy + 32]]), ...texto('QUADRAS', x0 + 30, y0 + dy + 31, `Q-0${q}`));
    for (let l = 0; l < 3; l++) {
      const x = x0 + l * 12;
      e.push(...poli('LOTES', [[x, y0 + dy], [x + 12, y0 + dy], [x + 12, y0 + dy + 30], [x, y0 + dy + 30]]), ...texto('NUMEROS', x + 6, y0 + dy + 15, String(l + 1)));
    }
  }
  return ['0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

test('loteamento: DXF do parcelamento → prévia → lotes gravados → Vitrine com os lotes no chão, buscador por quadra e o card do lote', async ({ page, request }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'loteamento');
  await page.getByLabel('Nome do projeto').fill('Residencial dos Ipês');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial dos Ipês/ }).click();
  await page.getByLabel('Nome do prédio').fill('Loteamento');
  await page.getByLabel('Andares').fill('1');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();

  // importar: primeiro a prévia (nada gravado), depois gravar
  const importar = page.getByTestId('importar-lotes');
  await importar.getByLabel('Arquivo do loteamento').setInputFiles({ name: 'parcelamento.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf()) });
  await importar.getByRole('button', { name: 'Ver a prévia' }).click();
  await expect(page.getByTestId('previa-lotes')).toContainText('Prévia (nada foi gravado): 6 lotes em 2 quadras, 2.160 m² no total.');
  await importar.getByRole('button', { name: 'Gravar os lotes' }).click();
  await expect(page.getByTestId('previa-lotes')).toContainText('Gravado: 6 lotes');

  // Vitrine: os lotes no chão, o buscador por quadra e o card do lote com as medidas do desenho
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await expect(vitrine).toHaveAttribute('data-lotes', '6', { timeout: 30_000 });
  const busca = page.getByTestId('buscador-lotes');
  await expect(busca.getByTestId('contagem-lotes')).toHaveText('6 de 6 lotes');
  await busca.getByRole('group', { name: 'Quadras' }).getByRole('button', { name: '02' }).click();
  await expect(busca.getByTestId('contagem-lotes')).toHaveText('3 de 6 lotes');
  await busca.getByTestId('lista-lotes').getByRole('button', { name: /Q02 · L01/ }).click();
  const card = page.getByTestId('lote-selecionado');
  await expect(card).toContainText('360 m²');
  await expect(card).toContainText('12 m × 30 m');
  await expect(card).toContainText('Disponível');
  await vitrine.screenshot({ path: test.info().outputPath('loteamento.png') });
});
