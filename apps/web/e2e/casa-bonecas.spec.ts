import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

/**
 * Plano 12c, itens 1 e 3: corte "casa de bonecas" (paredes de cada unidade do andar, pintadas pela situação) e
 * planta 3D humanizada (câmera ortográfica de cima, pavimento mobiliado). Os dois usam o mesmo seletor de andar
 * do corte e são exclusivos entre si (ligar um desliga o outro).
 */
const PLANILHA = [
  'predio;andar;codigo;tipologia;area_m2;quartos;preco;status',
  'Torre B;1;101;Tipo 2Q;70;2;600.000,00;disponivel',
  'Torre B;1;102;Tipo 3Q;98;3;890.000,00;reservado',
  'Torre B;2;201;Tipo 2Q;70;2;620.000,00;vendido',
  'Torre B;2;202;Tipo 3Q;98;3;900.000,00;disponivel',
].join('\n');

test('casa de bonecas e planta 3D humanizada (Plano 12c, itens 1 e 3)', async ({ page, request }) => {
  test.setTimeout(180_000);
  await entrarComoAdminComMfa(page, request, 'bonecas');

  await page.getByLabel('Nome do projeto').fill('Residencial Bonecas');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Bonecas/ }).click();
  await page.getByLabel('Nome do prédio').fill('Torre B');
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

  // casa de bonecas (item 1): sem andar escolhido, o botão fica desativado
  const botaoBonecas = page.getByRole('button', { name: /^(Casa de bonecas|Sair da casa de bonecas)$/ });
  await expect(botaoBonecas).toBeDisabled();
  await page.getByLabel('Ver até o andar (corte)').selectOption({ label: '1º andar' });
  await botaoBonecas.click();
  await expect(vitrine).toHaveAttribute('data-casa-bonecas', '1', { timeout: 15_000 });
  await expect(botaoBonecas).toHaveText('Sair da casa de bonecas');
  await botaoBonecas.click();
  await expect(vitrine).toHaveAttribute('data-casa-bonecas', '', { timeout: 15_000 });

  // comando por texto/voz: "casa de bonecas do 2º andar" (lib/comandos.ts) muda também o seletor do corte
  await page.getByLabel('Peça o que quiser ver').fill('casa de bonecas do 2º andar');
  await page.getByLabel('Peça o que quiser ver').press('Enter');
  await expect(vitrine).toHaveAttribute('data-casa-bonecas', '2', { timeout: 15_000 });
  await expect(page.getByLabel('Ver até o andar (corte)')).toHaveValue('2');
  await expect(page.getByTestId('retorno-comando')).toContainText('casa de bonecas do 2º andar');

  // "sai da casa de bonecas" por comando
  await page.getByLabel('Peça o que quiser ver').fill('sai da casa de bonecas');
  await page.getByLabel('Peça o que quiser ver').press('Enter');
  await expect(vitrine).toHaveAttribute('data-casa-bonecas', '', { timeout: 15_000 });

  // planta 3D humanizada (item 3): câmera ortográfica de cima, no andar escolhido (o 2º, do passo anterior)
  const botaoPlanta = page.getByTestId('secoes').getByRole('button', { name: /^(Planta|Voltar ao 3D)$/ });
  await botaoPlanta.click();
  await expect(vitrine).toHaveAttribute('data-planta', 'sim', { timeout: 15_000 });
  await expect(botaoPlanta).toHaveText('Voltar ao 3D');

  // os dois modos são exclusivos: ligar a casa de bonecas agora tira a planta
  await page.getByLabel('Ver até o andar (corte)').selectOption({ label: '1º andar' });
  await botaoBonecas.click();
  await expect(vitrine).toHaveAttribute('data-casa-bonecas', '1', { timeout: 15_000 });
  await expect(vitrine).toHaveAttribute('data-planta', 'nao', { timeout: 15_000 });

  // "Voltar ao 3D" sai da planta (e, pelo mesmo caminho, confirma que ligar a planta tira a casa de bonecas)
  await botaoPlanta.click();
  await expect(vitrine).toHaveAttribute('data-planta', 'sim', { timeout: 15_000 });
  await expect(vitrine).toHaveAttribute('data-casa-bonecas', '', { timeout: 15_000 });
  await botaoPlanta.click();
  await expect(vitrine).toHaveAttribute('data-planta', 'nao', { timeout: 15_000 });
});
