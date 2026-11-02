import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

const PLANILHA = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre G;1;101;Tipo 2Q;70;2;610.000,00;disponivel', 'Torre G;2;201;Tipo 2Q;70;2;640.000,00;disponivel'].join('\n');

test('visita em grupo: duas pessoas no mesmo link se veem na sala e o boneco de cada uma aparece no 3D da outra', async ({ page, request, browser }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'grupo');
  await page.getByLabel('Nome do projeto').fill('Residencial Família');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Família/ }).click();
  await page.waitForURL(/\/painel\/projetos\/[\w-]+$/);
  await page.getByLabel('Nome do prédio').fill('Torre G');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const link = (await page.getByTestId('link-cliente').textContent())!.trim();
  await page.goto('about:blank'); // um 3D a menos dividindo a CPU

  const abrir = async (nome: string) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(link);
    await expect(p.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
    const grupo = p.getByTestId('visita-grupo');
    await grupo.getByLabel('Seu nome na visita').fill(nome);
    await grupo.getByRole('button', { name: 'Entrar na visita em grupo' }).click();
    await expect(grupo).toHaveAttribute('data-estado', 'na_sala', { timeout: 30_000 });
    await p.getByRole('button', { name: 'Andar a pé (1ª pessoa)' }).click();
    return { ctx, p, grupo };
  };
  const ana = await abrir('Ana');
  const beto = await abrir('Beto');
  // cada um vê o outro na lista e o boneco dele no 3D
  await expect(ana.grupo).toHaveAttribute('data-pessoas', '1', { timeout: 30_000 });
  await expect(beto.grupo).toHaveAttribute('data-pessoas', '1', { timeout: 30_000 });
  await expect(ana.grupo).toContainText('Beto');
  await expect(ana.p.getByTestId('vitrine-3d')).toHaveAttribute('data-outros', '1', { timeout: 30_000 });
  await expect(beto.p.getByTestId('vitrine-3d')).toHaveAttribute('data-outros', '1', { timeout: 30_000 });
  // quem sai some da visita do outro
  await beto.grupo.getByRole('button', { name: 'Sair da visita' }).click();
  await expect(ana.grupo).toHaveAttribute('data-pessoas', '0', { timeout: 30_000 });
  await expect(ana.p.getByTestId('vitrine-3d')).toHaveAttribute('data-outros', '0', { timeout: 30_000 });
  await ana.ctx.close();
  await beto.ctx.close();
});
