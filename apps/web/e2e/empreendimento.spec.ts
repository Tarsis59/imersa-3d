import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

const PLANILHA = [
  'predio;andar;codigo;tipologia;area_m2;quartos;suites;vagas;preco;status',
  'Torre A;1;101;Tipo 2Q;72,5;2;1;1;650.000,00;disponivel',
  'Torre A;1;102;Tipo 3Q;98;3;1;2;890.000,00;disponivel',
  'Torre A;2;201;Tipo 2Q;72,5;2;1;1;660.000,00;reservado',
  'Torre A;2;202;Tipo 3Q;98;3;1;2;900.000,00;vendido',
].join('\n');

test('empreendimento: dados, importação com prévia, espelho de vendas e mudança de status', async ({ page, request }) => {
  await entrarComoAdminComMfa(page, request, 'emp');

  await page.getByLabel('Nome do projeto').fill('Residencial Paulista');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Paulista/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Residencial Paulista' })).toBeVisible();

  // dados e localização
  await page.getByLabel('Cidade').fill('São Paulo');
  await page.getByLabel('UF').fill('SP');
  await page.getByLabel('Latitude').fill('-23.56175');
  await page.getByLabel('Longitude').fill('-46.6545');
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(page.getByText('Dados salvos.')).toBeVisible();
  await expect(page.getByText('Rascunho · São Paulo/SP')).toBeVisible();

  // planilha com erro: nada é gravado e o erro aponta linha e campo
  await page.getByLabel('Conteúdo da planilha').fill(`${PLANILHA}\nTorre A;x;999;;;;;;;`);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await expect(page.getByText('1 problema encontrado')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'deve ser número inteiro' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aplicar' })).toBeDisabled();

  // planilha certa: prévia → aplicar
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await expect(page.getByText('Prévia (nada foi gravado).')).toBeVisible();
  await expect(page.getByText('4 unidades novas')).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await expect(page.getByTestId('resumo-status')).toContainText('Disponível: 2');
  await expect(page.getByTestId('resumo-status')).toContainText('Total: 4');

  // espelho de vendas
  await page.getByRole('link', { name: /Torre A/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Torre A' })).toBeVisible();
  await expect(page.getByTestId('unidade-202')).toHaveAttribute('data-status', 'vendido');
  const u101 = page.getByTestId('unidade-101');
  await expect(u101).toHaveAttribute('data-status', 'disponivel');
  await u101.click();
  await expect(page.getByRole('heading', { name: 'Unidade 101' })).toBeVisible();
  await page.getByLabel('Novo status').selectOption('reservado');
  await page.getByRole('button', { name: 'Mudar status' }).click();
  await expect(page.getByText('Status alterado.')).toBeVisible();
  await expect(page.getByTestId('unidade-101')).toHaveAttribute('data-status', 'reservado');
  await expect(page.getByTestId('status-selecionada')).toHaveText('Reservado');

  // distrato exige motivo
  await page.getByTestId('unidade-202').click();
  await expect(page.getByLabel('Motivo do distrato (obrigatório)')).toBeVisible();
  await page.getByLabel('Motivo do distrato (obrigatório)').fill('Distrato assinado');
  await page.getByRole('button', { name: 'Mudar status' }).click();
  await expect(page.getByTestId('unidade-202')).toHaveAttribute('data-status', 'disponivel');
});
