import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

const linhas = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status'];
for (let a = 1; a <= 6; a++) for (let f = 1; f <= 4; f++) linhas.push(`Torre S;${a};${a}0${f};Tipo 2Q;70;2;${600 + a * 10 + f}.000,00;disponivel`);

test('sol e vista: horas de sol por unidade (com a sombra dos prédios reais), filtro de sol e a vista da janela', async ({ page, request }) => {
  test.setTimeout(240_000);
  await entrarComoAdminComMfa(page, request, 'sol');
  await page.getByLabel('Nome do projeto').fill('Residencial Sol');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Sol/ }).click();
  await page.getByLabel('Latitude').fill('-23.56175');
  await page.getByLabel('Longitude').fill('-46.6545');
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(page.getByText('Dados salvos.')).toBeVisible();
  await page.getByLabel('Nome do prédio').fill('Torre S');
  await page.getByLabel('Andares').fill('6');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(linhas.join('\n'));
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await expect(vitrine).toHaveAttribute('data-entorno', /^\d+$/, { timeout: 60_000 }); // prédios reais da Paulista em volta

  // cartão da unidade: horas de sol no inverno, outono/primavera e verão, e de que parte do dia vem
  const lista = page.getByTestId('lista-vitrine');
  await lista.getByRole('button', { name: /^601/ }).click();
  const sol = page.getByTestId('sol-unidade');
  await expect(sol).toContainText(/Sol (da manhã|da tarde|o dia todo)|Pouco sol direto/);
  await expect(sol).toContainText(/\d+(,5)? h no inverno/);
  await expect(sol).toContainText('com a sombra dos prédios em volta');

  // filtro de sol: menos unidades que o total, e a lista só com as do período escolhido
  await expect(page.getByTestId('contagem-filtro')).toHaveText('24 de 24 unidades');
  await page.getByRole('checkbox', { name: 'Sol da manhã' }).check();
  const contagem = (await page.getByTestId('contagem-filtro').textContent())!;
  const n = Number(/^(\d+) de 24/.exec(contagem)?.[1]);
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(24);
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByTestId('contagem-filtro')).toHaveText('24 de 24 unidades');

  // vista da janela: câmera na varanda da unidade, olhando para fora; voltar ao prédio
  await lista.getByRole('button', { name: /^601/ }).click();
  await page.getByRole('button', { name: 'Ver a vista desta unidade' }).click();
  const id = await vitrine.getAttribute('data-vista');
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  await page.waitForTimeout(1500);
  await vitrine.screenshot({ path: test.info().outputPath('vista-601.png') });
  await page.getByRole('button', { name: 'Voltar ao prédio' }).click();
  await expect(vitrine).toHaveAttribute('data-vista', '');
});
