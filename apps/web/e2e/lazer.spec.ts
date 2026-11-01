import { test, expect, devices } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

const PLANILHA = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre L;1;101;Tipo 2Q;70;2;610.000,00;disponivel', 'Torre L;2;201;Tipo 2Q;70;2;640.000,00;disponivel'].join('\n');

test('lazer: a gestão marca no 3D, o tour "Conheça o lazer" mostra cada espaço e o tour completo conta nos Números', async ({ page, request, browser }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'lazer');
  await page.getByLabel('Nome do projeto').fill('Residencial Lazer');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Lazer/ }).click();
  await page.waitForURL(/\/painel\/projetos\/[\w-]+$/);
  const paginaProjeto = page.url();
  await page.getByLabel('Nome do prédio').fill('Torre L');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByLabel('Para quem (opcional)').fill('Família Lazer');
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const link = (await page.getByTestId('link-cliente').textContent())!.trim();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await expect(vitrine).toHaveAttribute('data-lazer', '0');

  // gestão: escolhe o tipo, dá o nome e clica no chão do 3D onde fica o espaço
  const cartao = page.getByTestId('lazer');
  const marcar = async (tipo: string, nome: string, descricao: string, fx: number) => {
    await cartao.getByLabel('Tipo').selectOption({ label: tipo });
    await cartao.getByLabel('Nome do espaço').fill(nome);
    await cartao.getByLabel('Descrição (opcional)').fill(descricao);
    await cartao.getByRole('button', { name: 'Marcar no 3D' }).click();
    await expect(vitrine).toHaveAttribute('data-marcando-lazer', 'sim');
    await vitrine.scrollIntoViewIfNeeded(); // o cartão fica abaixo do 3D no celular e em tela estreita
    const caixa = (await vitrine.boundingBox())!;
    await page.mouse.click(caixa.x + caixa.width * fx, caixa.y + caixa.height * 0.93);
    await expect(vitrine).toHaveAttribute('data-marcando-lazer', '');
  };
  await marcar('Piscina', 'Piscina adulto', 'Raia de 25 m, aquecida', 0.1);
  await expect(vitrine).toHaveAttribute('data-lazer', '1');
  await marcar('Academia', 'Academia', 'Aberta 24 h', 0.9);
  await expect(vitrine).toHaveAttribute('data-lazer', '2');
  await marcar('Playground', 'Playground', 'Piso emborrachado', 0.3);
  await expect(vitrine).toHaveAttribute('data-lazer', '3');
  await expect(cartao.getByTestId('lista-lazer').getByRole('listitem')).toHaveCount(3);
  // remover: some do 3D e da lista
  await cartao.getByRole('button', { name: 'Remover Playground' }).click();
  await expect(vitrine).toHaveAttribute('data-lazer', '2');

  // tocar num ponto da lista: voa até lá e mostra o espaço
  await cartao.getByTestId('lista-lazer').getByRole('button', { name: /Academia/ }).first().click(); // o 1º é o do voo; o 2º, o de remover
  const painel = page.getByTestId('tour-lazer');
  await expect(painel).toHaveAttribute('data-tour', 'ponto');
  await expect(painel).toContainText('Aberta 24 h');
  await painel.getByRole('button', { name: 'Fechar' }).click();
  await expect(painel).toHaveCount(0);

  // tour: um espaço de cada vez, com o progresso e o checklist
  await cartao.getByRole('button', { name: 'Conheça o lazer em 2 min' }).click();
  await expect(painel).toHaveAttribute('data-tour', 'andando');
  await expect(painel.getByTestId('progresso-tour')).toHaveText('1 de 2');
  await expect(painel).toContainText('Piscina adulto');
  await expect(painel).toContainText('Raia de 25 m, aquecida');
  await expect(cartao.getByLabel('visto', { exact: true })).toHaveCount(1);
  await painel.getByRole('button', { name: 'Próximo' }).click();
  await expect(painel.getByTestId('progresso-tour')).toHaveText('2 de 2');
  await expect(cartao.getByLabel('visto', { exact: true })).toHaveCount(2);
  await painel.getByRole('button', { name: 'Concluir' }).click();
  await expect(painel).toHaveAttribute('data-tour', 'completo');
  await expect(painel).toContainText('Você conheceu os 2 espaços do lazer.');
  await painel.getByRole('button', { name: 'Voltar ao prédio' }).click();
  await expect(painel).toHaveCount(0);

  // moradores caminhando na calçada: quantos depende da qualidade (no aparelho fraco, nenhum)
  const POR_NIVEL: Record<string, string> = { alto: '16', medio: '8', baixo: '0' };
  await expect
    .poll(async () => {
      const [nivel, n] = [await vitrine.getAttribute('data-nivel'), await vitrine.getAttribute('data-moradores')];
      return nivel ? POR_NIVEL[nivel] === n : false;
    })
    .toBe(true);
  // na calçada, a pé: os moradores passando (imagem anexada para revisão)
  await page.getByRole('button', { name: 'Andar a pé (1ª pessoa)' }).click();
  await page.keyboard.down('s'); // dois passos para trás, até o meio da calçada
  await page.waitForTimeout(1500);
  await page.keyboard.up('s');
  const quadro = (await vitrine.boundingBox())!;
  await page.mouse.move(quadro.x + quadro.width * 0.3, quadro.y + quadro.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(quadro.x + quadro.width * 0.3 + 390, quadro.y + quadro.height * 0.5, { steps: 12 }); // olha ao longo da calçada
  await page.mouse.up();
  await page.waitForTimeout(3000);
  await vitrine.screenshot({ path: test.info().outputPath('calcada-moradores.png') });
  await page.getByRole('button', { name: 'Voltar para a vista de cima' }).click();
  // som ambiente: liga no toque (pássaros, rua, água da piscina) e desliga
  await page.getByRole('button', { name: 'Ligar o som ambiente' }).click();
  await expect(vitrine).toHaveAttribute('data-som', 'ligado');
  await page.getByRole('button', { name: 'Desligar o som ambiente' }).click();
  await expect(vitrine).toHaveAttribute('data-som', 'desligado', { timeout: 10_000 });

  // cliente no celular: vê os mesmos pontos e faz o tour (o tour completo vai para os Números)
  const celular = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 });
  const cliente = await celular.newPage();
  await cliente.goto(link);
  await expect(cliente.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await expect(cliente.getByTestId('vitrine-3d')).toHaveAttribute('data-lazer', '2');
  await expect(cliente.getByTestId('lazer').getByRole('button', { name: 'Marcar no 3D' })).toHaveCount(0); // só a gestão marca
  await cliente.getByRole('button', { name: 'Conheça o lazer em 2 min' }).tap();
  const painelCliente = cliente.getByTestId('tour-lazer');
  await painelCliente.getByRole('button', { name: 'Próximo' }).tap();
  await painelCliente.getByRole('button', { name: 'Concluir' }).tap();
  await expect(painelCliente).toHaveAttribute('data-tour', 'completo');
  await cliente.close(); // ao sair, a página manda os eventos que faltam
  await celular.close();

  await page.goto(`${paginaProjeto}/numeros`);
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByTestId('numeros-tours-lazer').textContent();
      },
      { timeout: 45_000, intervals: [3_000] },
    )
    .toContain('1');
});
