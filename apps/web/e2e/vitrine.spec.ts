import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { layoutMarca } from '../../../packages/viewer/src/captura/marca';
import { API, entrarComoAdminComMfa } from './ajuda';
import { codigoTotp } from '../../api/src/auth/totp';

const PLANILHA = [
  'predio;andar;codigo;tipologia;area_m2;quartos;preco;status',
  'Torre V;1;101;Tipo 2Q;70;2;600.000,00;disponivel',
  'Torre V;1;102;Tipo 3Q;98;3;890.000,00;disponivel',
  'Torre V;1;103;Tipo 2Q;70;2;610.000,00;reservado',
  'Torre V;2;201;Tipo 2Q;70;2;620.000,00;disponivel',
  'Torre V;2;202;Tipo 3Q;98;3;900.000,00;vendido',
  'Torre V;2;203;Tipo 2Q;70;2;630.000,00;disponivel',
].join('\n');

test('vitrine 3D: volumes do prédio, filtros, favoritos, voo até a unidade, corte por andar, bússola e primeira pessoa', async ({ page, request }) => {
  test.setTimeout(300_000);
  const conta = await entrarComoAdminComMfa(page, request, 'vitrine');

  await page.getByLabel('Nome do projeto').fill('Residencial Vitrine');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Vitrine/ }).click();
  await page.getByLabel('Latitude').fill('-23.56175');
  await page.getByLabel('Longitude').fill('-46.6545');
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(page.getByText('Dados salvos.')).toBeVisible();
  // um lugar próximo (a estação de metrô), direto pela API: o "O que há perto" da Vitrine desenha a rota até ele
  const projetoId = new URL(page.url()).pathname.split('/').at(-1)!;
  await page.waitForTimeout(30_500 - (Date.now() % 30_000)); // o código de 6 dígitos não vale duas vezes: espera o próximo
  const { acesso } = await (await request.post(`${API}/auth/login`, { data: { email: conta.email, senha: conta.senha, empresa: conta.empresa, codigoMfa: codigoTotp(conta.segredo) } })).json();
  const metro = await request.post(`${API}/projetos/${projetoId}/pois`, { headers: { authorization: `Bearer ${acesso}` }, data: { categoria: 'transporte', nome: 'Estação Trianon-MASP', lat: -23.5614, lon: -46.6564 } });
  expect(metro.status()).toBe(201);
  await page.getByLabel('Nome do prédio').fill('Torre V');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await expect(page.getByText('Prévia (nada foi gravado).')).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();

  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 45_000 });
  await expect(page.getByText('as unidades aparecem como volumes por andar')).toBeVisible();
  await expect(page.getByTestId('contagem-filtro')).toHaveText('6 de 6 unidades');

  // entorno: prédios reais da Av. Paulista em volta (do OSM), com a atribuição exigida pela licença
  await expect(vitrine).toHaveAttribute('data-entorno', /^\d+$/, { timeout: 30_000 });
  expect(Number(await vitrine.getAttribute('data-entorno'))).toBeGreaterThan(300);
  // carros nas ruas do entorno (Plano 12a, item 10) e nuvens baixas (item 15): o atributo existe sempre; a
  // contagem de carros pode cair a 0 se a qualidade adaptativa descer para "baixo" num CI lento
  await expect(vitrine).toHaveAttribute('data-carros', /^\d+$/, { timeout: 30_000 });
  await expect(vitrine).toHaveAttribute('data-nuvens', /^(sim|nao)$/, { timeout: 30_000 });
  await expect(page.getByRole('link', { name: /OpenStreetMap/ })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  await expect(page.getByTestId('aviso-entorno')).toContainText('prédios reais em volta');

  // imagem com a marca: PNG do tamanho do 3D + faixa (empresa, prédio, data, atribuição do OSM)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Baixar imagem (PNG)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^torre-v-\d{4}-\d{2}-\d{2}\.png$/);
  const png = await readFile((await download.path())!);
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  const tela = await vitrine.locator('canvas').evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
  expect(png.readUInt32BE(16)).toBe(tela.w);
  expect(png.readUInt32BE(20)).toBe(layoutMarca(tela.w, tela.h).alturaTotal);

  // telemetria: bússola e qualidade
  await expect(page.getByTestId('bussola')).toHaveAttribute('aria-label', /^Olhando para (N|NE|L|SE|S|SO|O|NO) \(\d+°\)$/);
  await expect(page.getByTestId('qualidade')).toContainText('FPS · qualidade');

  // filtros
  await page.getByLabel('3 quartos').check();
  await expect(page.getByTestId('contagem-filtro')).toHaveText('2 de 6 unidades');
  // etiquetas "Apto 102" em cima das unidades filtradas (Plano 12b); sem filtro, nenhuma
  await expect(vitrine).toHaveAttribute('data-etiquetas', '2', { timeout: 30_000 });
  // busca pelo número na lista (não mexe no 3D)
  await page.getByLabel('Buscar unidade pelo número').fill('10');
  await expect(page.getByTestId('contagem-filtro')).toHaveText('1 de 6 unidades');
  await page.getByLabel('Buscar unidade pelo número').fill('');
  await page.getByLabel('Preço máximo (R$)').fill('895000');
  await expect(page.getByTestId('contagem-filtro')).toHaveText('1 de 6 unidades');
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByTestId('contagem-filtro')).toHaveText('6 de 6 unidades');
  await expect(vitrine).toHaveAttribute('data-etiquetas', '0', { timeout: 30_000 });

  // favoritos (sobrevivem a recarregar a página)
  await page.getByRole('button', { name: 'Favoritar 202' }).click();
  await page.getByLabel(/Só favoritas \(1\)/).check();
  await expect(page.getByTestId('contagem-filtro')).toHaveText('1 de 6 unidades');

  // voo até a unidade: cartão com os dados reais
  await page.getByTestId('lista-vitrine').getByRole('button', { name: /^202/ }).click();
  const cartao = page.getByTestId('unidade-selecionada');
  await expect(page.getByRole('heading', { name: 'Unidade 202' })).toBeVisible();
  await expect(cartao).toContainText('Vendido');
  await expect(cartao).toContainText('98 m²');
  await expect(cartao).toContainText(/R\$\s900\.000/); // o formato BR usa espaço não separável
  await expect(cartao.getByRole('button', { name: '★ Favorita' })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 45_000 });
  await expect(page.getByLabel(/Só favoritas \(1\)/)).toBeVisible();

  // o que há perto: tempo a pé, filtro por tipo e a rota desenhada no chão pelas ruas (Plano 12)
  const perto = page.getByTestId('proximidades');
  await expect(perto).toContainText('Estação Trianon-MASP');
  await expect(perto).toContainText(/\d+ min a pé/);
  await perto.getByRole('group', { name: 'Tipo de lugar' }).getByRole('button', { name: 'Transporte' }).click();
  await perto.getByRole('button', { name: /Estação Trianon-MASP/ }).click();
  await expect(vitrine).toHaveAttribute('data-rota', /^[3-9]|^\d{2,}/, { timeout: 15_000 });
  await perto.getByRole('button', { name: 'Apagar a rota' }).click();
  await expect(vitrine).toHaveAttribute('data-rota', '0');

  // corte por andar
  await page.getByLabel('Ver até o andar (corte)').selectOption({ label: '1º andar' });
  await expect(vitrine).toHaveAttribute('data-corte', '1');
  await page.getByLabel('Ver até o andar (corte)').selectOption({ label: 'Prédio inteiro' });
  await expect(vitrine).toHaveAttribute('data-corte', 'nenhum');

  // vista explodida (Plano 12c): os andares se separam e juntam de novo; andar a pé junta sozinho
  await page.getByRole('button', { name: 'Separar os andares' }).click();
  await expect(vitrine).toHaveAttribute('data-explosao', '1', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Juntar os andares' }).click();
  await expect(vitrine).toHaveAttribute('data-explosao', '0', { timeout: 15_000 });

  // primeira pessoa: anda com o teclado e mostra o joystick de toque
  await page.getByRole('button', { name: 'Andar a pé (1ª pessoa)' }).click();
  await expect(vitrine).toHaveAttribute('data-modo', 'primeira-pessoa');
  await expect(page.getByTestId('joystick')).toBeVisible();
  await expect(vitrine).not.toHaveAttribute('data-posicao', '');
  const zAntes = Number((await vitrine.getAttribute('data-posicao'))!.split(',')[1]);
  await page.keyboard.down('s'); // para trás: sul, longe do prédio (sem colisão)
  await expect.poll(async () => Number((await vitrine.getAttribute('data-posicao'))!.split(',')[1]), { timeout: 15_000 }).toBeGreaterThan(zAntes + 0.5);
  await page.keyboard.up('s');
  await page.getByRole('button', { name: 'Voltar para a vista de cima' }).click();
  await expect(vitrine).toHaveAttribute('data-modo', 'orbita');

  // telemetria: ao sair da Vitrine a visita é enviada (sendBeacon) e aparece no painel de desempenho
  await page.getByRole('link', { name: 'Desempenho 3D' }).click();
  await expect(page.getByRole('heading', { name: 'Desempenho do 3D' })).toBeVisible();
  await expect
    .poll(
      async () => {
        await page.reload();
        return Number(await page.getByTestId('telemetria-visitas').textContent());
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(2); // a do recarregamento no meio do teste + a da saída agora
});
