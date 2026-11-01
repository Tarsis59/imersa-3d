import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';
import { comExifGps } from './exif';

// foto do imóvel com GPS na Av. Paulista (onde está o arquivo de prédios reais do e2e)
// tirada 40 m ao sul do ponto, olhando para o norte (bússola): vira um quadro no 3D ali
const FOTO = comExifGps(new Uint8Array(readFileSync(new URL('./fixtures/video-fzk-capa.jpg', import.meta.url))), -23.56175 - 40 / 110_540, -46.6545, { rumo: 0 });
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const TEXTO = 'Residencial Paulista Vista, 6 andares, 4 apartamentos por andar, 2 e 3 quartos de 60 e 80 m², piscina, academia e churrasqueira.';

test('criar com tudo: foto com GPS + planta + texto → montagem ao vivo → Vitrine com unidades, lazer e cidade', async ({ page, request }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'criar');
  await page.getByTestId('ir-criar').click();
  await expect(page).toHaveURL(/\/painel\/criar$/);

  // 1. larga os arquivos: o classificador separa foto (com GPS) e planta; .txt vira a descrição
  await page.getByTestId('entrada-arquivos').setInputFiles([
    { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(FOTO) },
    { name: 'Planta Pavimento Tipo.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'descricao.txt', mimeType: 'text/plain', buffer: Buffer.from(TEXTO) },
    { name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
  ]);
  const itens = page.getByTestId('item-criacao');
  await expect(itens).toHaveCount(2);
  await expect(itens.filter({ hasText: 'IMG_0001.jpg' })).toHaveAttribute('data-papel', 'foto');
  await expect(itens.filter({ hasText: 'IMG_0001.jpg' })).toContainText('com GPS');
  await expect(itens.filter({ hasText: 'Planta Pavimento' })).toHaveAttribute('data-papel', 'planta');
  await expect(page.getByText(/virus\.exe: tipo não aceito/)).toBeVisible();
  await expect(page.getByLabel('Descrição (do jeito que você fala)')).toHaveValue(TEXTO);
  await expect(page.getByTestId('local-gps')).toContainText('1 foto(s) com GPS');

  // corrige com um toque: a planta, na verdade, é um documento... e volta
  const papelPlanta = page.getByLabel('O que é Planta Pavimento Tipo.pdf');
  await papelPlanta.selectOption('documento');
  await expect(itens.filter({ hasText: 'Planta Pavimento' })).toHaveAttribute('data-papel', 'documento');
  await papelPlanta.selectOption('planta');

  // 2-3. lê o texto e mostra o que entendeu; a pessoa corrige os andares e o plano recalcula
  await page.getByRole('button', { name: 'Entender o texto' }).click();
  await expect(page.getByLabel('Nome do empreendimento')).toHaveValue('Residencial Paulista Vista');
  await expect(page.getByTestId('tipologia-entendida')).toHaveCount(2);
  await expect(page.getByTestId('lazer-entendido')).toHaveText(['Piscina ✕', 'Academia ✕', 'Churrasqueira ✕']);
  await expect(page.getByTestId('resumo-plano')).toContainText('Vai criar 24 unidades em 6 andares (4 por andar)');
  await page.getByRole('spinbutton', { name: 'Andares', exact: true }).fill('8');
  await expect(page.getByTestId('resumo-plano')).toContainText('Vai criar 32 unidades em 8 andares');
  await expect(page.getByTestId('resumo-plano')).toContainText('16 de 2 quartos (60 m²), 16 de 3 quartos (80 m²)');
  await page.getByRole('radio', { name: /Clássico/ }).click();
  await expect(page.getByRole('radio', { name: /Clássico/ })).toHaveAttribute('aria-checked', 'true');

  // 4. cria: envia os arquivos e acompanha a montagem ao vivo
  await page.getByTestId('criar-empreendimento').click();
  await expect(page).toHaveURL(/\/painel\/projetos\/[\w-]+\/montagem$/, { timeout: 60_000 });
  const montagem = page.getByTestId('montagem');
  // os pontos próximos vêm do OSM de verdade (pode não responder no CI): pronta ou pronta com avisos
  await expect(montagem).toHaveAttribute('data-estado', /^pronta/, { timeout: 120_000 });
  await expect(page.getByTestId('etapa-local')).toHaveAttribute('data-estado', 'feita');
  await expect(page.getByTestId('etapa-local')).toContainText('Achado pelo GPS das fotos.');
  await expect(page.getByTestId('etapa-predio')).toContainText('32 unidades em 8 andares');
  await expect(page.getByTestId('etapa-lazer')).toHaveAttribute('data-estado', 'feita');
  await expect(page.getByTestId('etapa-cidade')).toHaveAttribute('data-estado', 'feita');
  await expect(page.getByTestId('etapa-arquivos')).toContainText('1 planta na fila de leitura');
  await expect(page.getByTestId('etapa-arquivos')).toContainText('1 guardado nos arquivos do empreendimento');

  // a Vitrine abre com o prédio desenhado, o lazer pronto para o tour e os prédios reais em volta
  await page.getByTestId('abrir-vitrine').click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await expect(vitrine).toHaveAttribute('data-lazer', '3');
  await expect(vitrine).toHaveAttribute('data-entorno', /^[1-9]\d*$/, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: /Conheça o lazer/ })).toBeVisible();
  // a foto com GPS virou um quadro no lugar em que foi tirada
  await expect(vitrine).toHaveAttribute('data-fotos', '1');
  await page.waitForTimeout(2000);
  await vitrine.screenshot({ path: test.info().outputPath('cidade-completa.png') });

  // comandos por texto: a tela obedece na hora (e diz o que entendeu)
  const comando = page.getByLabel('Peça o que quiser ver');
  await comando.fill('mostre as de 3 quartos à noite');
  await comando.press('Enter');
  await expect(page.getByTestId('retorno-comando')).toHaveText('Entendi: 3 quartos · às 21h.');
  await expect(page.getByLabel(/^Hora/)).toHaveValue('21');
  await comando.fill('vá para a piscina');
  await comando.press('Enter');
  await expect(page.getByTestId('retorno-comando')).toHaveText('Entendi: piscina.');
  await comando.fill('vá para a quadra de tênis');
  await comando.press('Enter');
  await expect(page.getByTestId('retorno-comando')).toContainText('não está no lazer deste empreendimento');
  await comando.fill('limpar filtros e voltar para o prédio');
  await comando.press('Enter');
  await expect(page.getByTestId('retorno-comando')).toHaveText('Entendi: sem filtros · visão geral.');

  // apartamento decorado no estilo escolhido: entra na 101 e já vê a sala mobiliada
  await page.getByTestId('lista-vitrine').getByRole('button', { name: /^101/ }).click();
  await page.getByRole('button', { name: 'Entrar no apartamento' }).click();
  await expect(vitrine).toHaveAttribute('data-modo', 'primeira-pessoa', { timeout: 15_000 });
  await expect(vitrine).toHaveAttribute('data-decorado', /^[1-9]\d*$/, { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await vitrine.screenshot({ path: test.info().outputPath('decorado-101.png') });
  await page.getByRole('button', { name: 'Sair do apartamento' }).click();
  await expect(vitrine).toHaveAttribute('data-decorado', '0');
});
