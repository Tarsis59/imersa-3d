import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

// Assistente simulado (IA_SIMULADA no servidor de teste): mesmo caminho do real (ferramentas no servidor, fluxo SSE,
// ações na tela), sem custo. O comportamento do Claude de verdade é medido à parte, na avaliação.
const PLANILHA = [
  'predio;andar;codigo;tipologia;area_m2;quartos;preco;status',
  'Torre IA;1;101;Tipo 2Q;72;2;550.000,00;disponivel',
  'Torre IA;1;102;Tipo 3Q;98;3;890.000,00;disponivel',
  'Torre IA;2;201;Tipo 3Q;98;3;910.000,00;vendido',
  'Torre IA;2;202;Tipo 2Q;72;2;560.000,00;disponivel',
].join('\n');

test('assistente com IA: pergunta no painel destaca e voa até a unidade; no link do cliente, “agendar visita” abre o formulário', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await entrarComoAdminComMfa(page, page.request, 'assistente');
  await page.getByLabel('Nome do projeto').fill('Residencial Assistente');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Assistente/ }).click();
  await page.getByLabel('Nome do prédio').fill('Torre IA');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.waitForURL(/\/painel\/predios\/[0-9a-f-]+$/);
  const predio = page.url();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });

  // painel: sugestão de pergunta → resposta em fluxo com os preços reais → só as de 3 quartos disponíveis em destaque
  const chat = page.getByTestId('assistente');
  // corretora virtual: aparece no 3D (e lê as respostas em voz alta)
  await page.getByLabel(/Corretora virtual/).check();
  // o aviso sai no quadro seguinte; no 3D por software (CI) o 1º quadro com o boneco leva segundos
  await expect(vitrine).not.toHaveAttribute('data-corretora', 'fora', { timeout: 30_000 });
  await chat.getByRole('button', { name: 'Quais unidades de 3 quartos estão disponíveis?' }).click();
  const resposta = chat.locator('[data-papel="assistente"]').last();
  await expect(resposta).toHaveText(/^Encontrei 1 unidade: 102 \(R\$\s890\.000,00\)\. Destaquei no 3D\.$/, { timeout: 30_000 });
  await expect(vitrine).not.toHaveAttribute('data-destaque-ia', '');
  await expect(page.getByRole('heading', { name: 'Unidade 102' })).toBeVisible();
  await vitrine.screenshot({ path: test.info().outputPath('corretora.png') });
  // o que não é comando de tela, escrito na barra de comandos, vai para o assistente
  await page.getByLabel('Peça o que quiser ver').fill('qual o valor do condomínio?');
  await page.getByLabel('Peça o que quiser ver').press('Enter');
  await expect(page.getByTestId('retorno-comando')).toHaveText('Perguntei ao assistente (veja a resposta abaixo).');
  await expect(chat.locator('[data-papel="cliente"]').last()).toHaveText('qual o valor do condomínio?');
  await expect(chat.locator('[data-papel="assistente"]').last()).not.toHaveText('', { timeout: 30_000 });

  // nova pergunta continua a conversa (o histórico vai junto)
  await chat.getByLabel('Sua pergunta').fill('E de 2 quartos?');
  await chat.getByRole('button', { name: 'Perguntar' }).click();
  await expect(chat.locator('[data-papel="assistente"]').last()).toHaveText(/^Encontrei 2 unidades: 101 \(R\$\s550\.000,00\), 202 \(R\$\s560\.000,00\)\. Destaquei no 3D\.$/, { timeout: 30_000 });
  await expect(chat.locator('[data-papel="cliente"]')).toHaveCount(3); // a do condomínio veio da barra de comandos

  // link do cliente (sem login): o assistente abre o formulário de contato com o motivo
  await page.goto(predio);
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const link = (await page.getByTestId('link-cliente').textContent())!.trim();
  const cliente = await browser.newContext();
  const portal = await cliente.newPage();
  await portal.goto(link);
  await expect(portal.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  const chatPortal = portal.getByTestId('assistente');
  await chatPortal.getByRole('button', { name: 'Quero agendar uma visita' }).click();
  await expect(chatPortal.locator('[data-papel="assistente"]').last()).toHaveText(/Abri o formulário/, { timeout: 30_000 });
  await expect(portal.locator('#lead-mensagem')).toHaveValue('Quero agendar uma visita.');
  await expect(portal.locator('#contato')).toBeInViewport({ ratio: 0.3 });
  await cliente.close();
});
