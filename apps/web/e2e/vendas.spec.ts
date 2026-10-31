import { test, expect, devices } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

const PLANILHA = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre V;1;101;Tipo 2Q;70;2;610.000,00;disponivel', 'Torre V;1;102;Tipo 3Q;98;3;820.000,00;disponivel', 'Torre V;2;201;Tipo 2Q;70;2;640.000,00;vendido'].join('\n');

test('vendas: link pelo WhatsApp → cliente no celular (sem login) → pedido de contato → leads e números no painel', async ({ page, request, browser }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'vendas');
  await page.getByLabel('Nome do projeto').fill('Residencial Aurora');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Aurora/ }).click();
  await page.getByLabel('Nome do prédio').fill('Torre V');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  const projetoUrl = page.url();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();

  // consultora/gestão gera o link
  await page.getByLabel('Para quem (opcional)').fill('Família Souza');
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const link = (await page.getByTestId('link-cliente').textContent())!.trim();
  expect(link).toMatch(/^http:\/\/localhost:3100\/v\/[\w-]{43}$/);
  await expect(page.getByRole('link', { name: 'Enviar pelo WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=.*Residencial%20Aurora/);
  await expect(page.getByTestId('lista-links').getByRole('listitem').first()).toContainText('Família Souza');

  // prévia do WhatsApp: título, descrição e imagem gerada
  const html = await (await request.get(link)).text();
  expect(html).toContain('<meta property="og:title" content="Residencial Aurora · Torre V em 3D"');
  expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  const imagem = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  expect(imagem).toMatch(/^http:\/\/localhost:3100\/v\/.+\/opengraph-image/);
  const png = await request.get(imagem!.replaceAll('&amp;', '&'));
  expect(png.status()).toBe(200);
  expect(png.headers()['content-type']).toBe('image/png');

  // cliente no celular, sem login
  const celular = await browser.newContext({ ...devices['Pixel 7'] });
  const cliente = await celular.newPage();
  const eventos = (r: import('@playwright/test').Response) => r.url().includes('/eventos') && r.request().method() === 'POST';
  const abriu = cliente.waitForResponse(eventos, { timeout: 60_000 });
  await cliente.goto(link);
  expect((await abriu).status()).toBe(204); // a visita foi registrada
  await expect(cliente.getByRole('heading', { name: 'Residencial Aurora · Torre V' })).toBeVisible();
  await expect(cliente.getByText(/Atendimento:/)).toContainText('Admin E2E');
  const vitrine = cliente.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  expect(await cliente.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await cliente.getByTestId('lista-vitrine').getByRole('button', { name: /^102/ }).tap();
  await expect(cliente.getByRole('heading', { name: 'Unidade 102' })).toBeVisible();
  await cliente.screenshot({ path: test.info().outputPath('portal-celular.png') });

  await cliente.getByRole('link', { name: /Quero falar com/ }).tap();
  await cliente.getByLabel('Seu nome').fill('Carla Mendes');
  await cliente.getByLabel('WhatsApp ou telefone (com DDD)').fill('(11) 97777-6666');
  await expect(cliente.getByLabel('Unidade de interesse (opcional)')).toHaveValue(/.+/); // a unidade vista já vem escolhida
  await cliente.getByLabel('Mensagem (opcional)').fill('Posso visitar no sábado?');
  const enviar = cliente.getByRole('button', { name: 'Enviar pedido de contato' });
  await expect(enviar).toBeDisabled(); // sem a autorização (LGPD) não envia
  await cliente.getByRole('checkbox', { name: /Autorizo/ }).check();
  await cliente.getByRole('checkbox', { name: /Autorizo/ }).scrollIntoViewIfNeeded();
  await cliente.screenshot({ path: test.info().outputPath('portal-contato.png') });
  await enviar.tap();
  await expect(cliente.getByText('Obrigado, Carla!')).toBeVisible({ timeout: 30_000 });
  // fechar a aba: o tempo de visita e a unidade vista saem pelo sendBeacon (pagehide)
  await cliente.close({ runBeforeUnload: true });

  // painel: lead com a unidade e a mensagem
  await page.goto('/painel/leads');
  const lead = page.getByTestId('lista-leads').getByRole('listitem').filter({ hasText: 'Carla Mendes' });
  await expect(lead).toContainText('unidade 102');
  await expect(lead).toContainText('Posso visitar no sábado?');
  await expect(lead.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/5511977776666');
  await lead.getByLabel('Situação de Carla Mendes').selectOption('em_contato');
  await expect(page.getByTestId('lista-leads').getByRole('listitem').filter({ hasText: 'Carla Mendes' })).toHaveAttribute('data-status-lead', 'em_contato');

  // números do empreendimento
  await page.goto(`${projetoUrl}/numeros`);
  await expect
    .poll(
      async () => {
        await page.reload();
        return `${await page.getByTestId('numeros-visitas').textContent()}/${await page.getByTestId('numeros-leads').textContent()}`;
      },
      { timeout: 30_000, intervals: [1_000] },
    )
    .toBe('1/1');
  await expect(page.getByTestId('numeros-consultoras')).toContainText('Admin E2E');
  await expect(page.getByTestId('numeros-unidades')).toContainText('102');
  await celular.close();

  // desativar o link: o cliente vê o aviso
  await page.goBack();
  await page.goto(projetoUrl);
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByTestId('lista-links').getByRole('button', { name: 'Desativar' }).click();
  await expect(page.getByTestId('lista-links').getByRole('listitem').first()).toHaveAttribute('data-status-link', 'revogado');
  const depois = await browser.newPage();
  await depois.goto(link);
  await expect(depois.getByRole('heading', { name: 'Este link não está mais disponível' })).toBeVisible();
  await depois.close();
});
