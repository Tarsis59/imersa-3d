import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

// DXF do parcelamento como o AutoCAD exporta: 2 quadras (layer QUADRAS, "Q-01" dentro) com 3 lotes de 12 × 30 m
// (layer LOTES, o número dentro), em UTM SIRGAS 2000 fuso 23, perto da Paulista; rua, calçada e meio-fio do lado
// leste da quadra (Plano 12d, item 8), para o terreno e a orientação do sol terem o que ler
const poli = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '1', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
const linha = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '0', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
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
  // a leste das duas quadras (x0 + 36 a x0 + 41): a frente dos lotes continua o lado leste, mais perto da rua
  e.push(...linha('CALCADAS', [[x0 + 37.5, y0 - 5], [x0 + 37.5, y0 + 85]]));
  e.push(...linha('MEIO_FIO', [[x0 + 39, y0 - 5], [x0 + 39, y0 + 85]]));
  e.push(...linha('RUAS', [[x0 + 41, y0 - 5], [x0 + 41, y0 + 85]]));
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
  // varredura em ciano (Plano 12d, item 4): os lotes no chão abrem/filtram com o anel; a prova confiável (os
  // atributos ligam e desligam certo) é o teste unitário de `lotes.ts` — aqui só confere que não quebra a tela e
  // que, um pouco depois do filtro, a onda já tiver acabado (não fica acesa para sempre)
  await expect(vitrine).toHaveAttribute('data-varredura', 'nao', { timeout: 5_000 });
  await busca.getByRole('group', { name: 'Quadras' }).getByRole('button', { name: '02' }).click();
  await expect(busca.getByTestId('contagem-lotes')).toHaveText('3 de 6 lotes');
  await expect(vitrine).toHaveAttribute('data-varredura', 'nao', { timeout: 10_000 });
  await busca.getByTestId('lista-lotes').getByRole('button', { name: /Q02 · L01/ }).click();
  const card = page.getByTestId('lote-selecionado');
  await expect(card).toContainText('360 m²');
  await expect(card).toContainText('12 m × 30 m');
  await expect(card).toContainText('Disponível');
  // orientação do sol (Plano 12d, item 6): lote de 12 × 30 m com o lado mais longo a leste, sem rua desenhada ainda
  await expect(card).toContainText('Leste');
  await expect(card).toContainText('sol da manhã');
  // "Ver daqui" (Plano 12d, item 11): câmera na calçada do lote, olhos a 1,60 m
  await expect(vitrine).toHaveAttribute('data-placas-lotes', 'sim');
  await card.getByTestId('ver-daqui').click();
  await expect(vitrine).toHaveAttribute('data-vista-lote', /.+/);
  // na altura dos olhos as placas de quadra/lote (feitas para a vista de cima) saem da frente
  await expect(vitrine).toHaveAttribute('data-placas-lotes', 'nao');
  // casa-modelo (Plano 12d, item 9): botão no card coloca a casa nas medidas do lote, com os recuos
  await card.getByTestId('casa-modelo').click();
  await expect(vitrine).toHaveAttribute('data-casa-modelo', /.+/);
  await expect(vitrine).toHaveAttribute('data-casa-modelo-3d', 'sim');
  await card.getByTestId('casa-modelo').click(); // alterna: tira a casa de novo
  await expect(vitrine).toHaveAttribute('data-casa-modelo', '');
  await expect(vitrine).toHaveAttribute('data-casa-modelo-3d', 'nao');
  // fechar o lote com a casa à mostra, na vista da calçada: a casa sai do 3D e a câmera volta à visão geral dos lotes
  await card.getByTestId('casa-modelo').click();
  await expect(vitrine).toHaveAttribute('data-casa-modelo-3d', 'sim');
  await card.getByRole('button', { name: 'Fechar o lote' }).click();
  await expect(vitrine).toHaveAttribute('data-casa-modelo-3d', 'nao');
  await expect(vitrine).toHaveAttribute('data-casa-modelo', '');
  await expect(vitrine).toHaveAttribute('data-vista-lote', '');
  await expect(vitrine).toHaveAttribute('data-placas-lotes', 'sim');
  // reabre o lote para as verificações seguintes
  await busca.getByTestId('lista-lotes').getByRole('button', { name: /Q02 · L01/ }).click();
  await expect(card).toContainText('360 m²');
  // terreno e infraestrutura (Plano 12d, item 8): o DXF trouxe rua, calçada e meio-fio, então o controle aparece
  await expect(vitrine).toHaveAttribute('data-anos', '10'); // padrão: árvores adultas
  const anos = page.getByTestId('daqui-a-10-anos');
  const controle = anos.getByLabel(/Árvores do loteamento/);
  await controle.focus();
  await controle.press('Home'); // o mínimo do range (0 anos, muda recém-plantada)
  await expect(vitrine).toHaveAttribute('data-anos', '0');
  await vitrine.screenshot({ path: test.info().outputPath('loteamento.png') });
});

// Loteamento grande, do tamanho do exemplo do Plano 12d (item 2): 34 quadras com 3 lotes de 12 × 30 m cada
// (102 lotes), mesmo formato DXF da função acima, numa coluna só (a distância entre quadras não importa aqui).
function dxfGrande(nQuadras: number): string {
  const e: string[] = [];
  const [x0, y0] = [332_100, 7_394_300];
  for (let q = 1; q <= nQuadras; q++) {
    const dy = (q - 1) * 50;
    e.push(...poli('QUADRAS', [[x0 - 2, y0 + dy - 2], [x0 + 38, y0 + dy - 2], [x0 + 38, y0 + dy + 32], [x0 - 2, y0 + dy + 32]]), ...texto('QUADRAS', x0 + 30, y0 + dy + 31, `Q-${q}`));
    for (let l = 0; l < 3; l++) {
      const x = x0 + l * 12;
      e.push(...poli('LOTES', [[x, y0 + dy], [x + 12, y0 + dy], [x + 12, y0 + dy + 30], [x, y0 + dy + 30]]), ...texto('NUMEROS', x + 6, y0 + dy + 15, String(l + 1)));
    }
  }
  return ['0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

test('loteamento grande: DXF com 34 quadras → importar → filtrar por quadra → card do lote → pedir contato no portal → lead com o lote', async ({ page, request, browser }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'loteamento-grande');
  await page.getByLabel('Nome do projeto').fill('Parque das Acácias');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Parque das Acácias/ }).click();
  await page.getByLabel('Nome do prédio').fill('Loteamento');
  await page.getByLabel('Andares').fill('1');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();

  const importar = page.getByTestId('importar-lotes');
  await importar.getByLabel('Arquivo do loteamento').setInputFiles({ name: 'parcelamento-grande.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxfGrande(34)) });
  await importar.getByRole('button', { name: 'Ver a prévia' }).click();
  await expect(page.getByTestId('previa-lotes')).toContainText('Prévia (nada foi gravado): 102 lotes em 34 quadras, 36.720 m² no total.');
  await importar.getByRole('button', { name: 'Gravar os lotes' }).click();
  await expect(page.getByTestId('previa-lotes')).toContainText('Gravado: 102 lotes');

  // link do cliente (igual ao fluxo de vendas, Plano 06/12b)
  await page.getByLabel('Seu WhatsApp (opcional)').fill('(11) 98888-2222');
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const link = (await page.getByTestId('link-cliente').textContent())!.trim();

  // cliente no portal público: filtra pela quadra 20, abre o lote 2 e pede contato
  const cliente = await browser.newPage();
  await cliente.goto(link);
  const vitrine = cliente.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await expect(vitrine).toHaveAttribute('data-lotes', '102', { timeout: 30_000 });
  const busca = cliente.getByTestId('buscador-lotes');
  await busca.getByRole('group', { name: 'Quadras' }).getByRole('button', { name: '20' }).click();
  await expect(busca.getByTestId('contagem-lotes')).toHaveText('3 de 102 lotes');
  await busca.getByTestId('lista-lotes').getByRole('button', { name: /Q20 · L02/ }).click();
  const card = cliente.getByTestId('lote-selecionado');
  await expect(card).toContainText('Disponível');

  await cliente.getByRole('link', { name: /Quero falar com/ }).click();
  await cliente.getByLabel('Seu nome', { exact: true }).fill('Rodrigo Pires');
  await cliente.getByLabel('WhatsApp ou telefone (com DDD)').fill('(11) 98888-3333');
  // o lote visto (escolhido acima) já vem marcado no formulário (como a unidade, no prédio)
  await expect(cliente.getByLabel('Lote de interesse (opcional)')).toHaveValue(/.+/);
  const enviar = cliente.getByRole('button', { name: 'Enviar pedido de contato' });
  await cliente.getByRole('checkbox', { name: /Autorizo/ }).check();
  await enviar.click();
  await expect(cliente.getByText('Obrigado, Rodrigo!')).toBeVisible({ timeout: 30_000 });
  await cliente.close();

  // painel de leads: o pedido chega com "lote X da quadra Y" (Plano 12e)
  await page.goto('/painel/leads');
  const lead = page.getByTestId('lista-leads').getByRole('listitem').filter({ hasText: 'Rodrigo Pires' });
  await expect(lead).toContainText('lote 02 da quadra 20');
});
