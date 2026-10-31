import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

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
  await entrarComoAdminComMfa(page, request, 'vitrine');

  await page.getByLabel('Nome do projeto').fill('Residencial Vitrine');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Vitrine/ }).click();
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

  // telemetria: bússola e qualidade
  await expect(page.getByTestId('bussola')).toHaveAttribute('aria-label', /^Olhando para (N|NE|L|SE|S|SO|O|NO) \(\d+°\)$/);
  await expect(page.getByTestId('qualidade')).toContainText('FPS · qualidade');

  // filtros
  await page.getByLabel('3 quartos').check();
  await expect(page.getByTestId('contagem-filtro')).toHaveText('2 de 6 unidades');
  await page.getByLabel('Preço máximo (R$)').fill('895000');
  await expect(page.getByTestId('contagem-filtro')).toHaveText('1 de 6 unidades');
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByTestId('contagem-filtro')).toHaveText('6 de 6 unidades');

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

  // corte por andar
  await page.getByLabel('Ver até o andar (corte)').selectOption({ label: '1º andar' });
  await expect(vitrine).toHaveAttribute('data-corte', '1');
  await page.getByLabel('Ver até o andar (corte)').selectOption({ label: 'Prédio inteiro' });
  await expect(vitrine).toHaveAttribute('data-corte', 'nenhum');

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
});
