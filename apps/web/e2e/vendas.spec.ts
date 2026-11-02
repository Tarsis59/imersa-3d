import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, devices } from '@playwright/test';
import { verificarAssinatura } from '../../api/src/integracoes/assinatura';
import { API, entrarComoAdminComMfa } from './ajuda';

const PLANILHA = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre V;1;101;Tipo 2Q;70;2;610.000,00;disponivel', 'Torre V;1;102;Tipo 3Q;98;3;820.000,00;disponivel', 'Torre V;2;201;Tipo 2Q;70;2;640.000,00;vendido'].join('\n');

test('vendas: link pelo WhatsApp → cliente no celular (sem login) → pedido de contato → leads, números e CRM (webhook + API)', async ({ page, request, browser }) => {
  test.setTimeout(300_000);
  // "CRM" de teste: recebe os webhooks
  const recebidos: Array<{ headers: IncomingHttpHeaders; corpo: string }> = [];
  const crm = createServer((r, s) => {
    let corpo = '';
    r.on('data', (c) => (corpo += c));
    r.on('end', () => {
      recebidos.push({ headers: r.headers, corpo });
      s.writeHead(200).end();
    });
  });
  await new Promise<void>((ok) => crm.listen(0, '127.0.0.1', ok));

  await entrarComoAdminComMfa(page, request, 'vendas');

  // integrações: chave de API e webhook para o CRM
  await page.getByRole('link', { name: 'Integrações' }).click();
  await page.getByLabel('Nome da chave').fill('CRM da construtora');
  await page.getByRole('button', { name: 'Criar chave' }).click();
  const chave = (await page.getByTestId('chave-nova').textContent())!.trim();
  expect(chave).toMatch(/^imk_/);
  await page.getByLabel('Endereço do CRM (https)').fill(`http://127.0.0.1:${(crm.address() as AddressInfo).port}/imersa`);
  await page.getByRole('button', { name: 'Cadastrar webhook' }).click();
  const segredo = (await page.getByTestId('segredo-webhook').textContent())!.trim();
  await expect(page.getByTestId('lista-webhooks')).toContainText('/imersa');
  await page.goto('/painel');

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
  await page.getByLabel('Seu WhatsApp (opcional)').fill('(11) 97777-1234');
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const link = (await page.getByTestId('link-cliente').textContent())!.trim();
  expect(link).toMatch(/^http:\/\/localhost:3100\/v\/[\w-]{43}$/);
  await expect(page.getByRole('link', { name: 'Enviar pelo WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=.*Residencial%20Aurora/);
  await expect(page.getByTestId('lista-links').getByRole('listitem').first()).toContainText('Família Souza');

  // prévia do WhatsApp: título, descrição e imagem gerada
  // app instalável: o manifesto do link abre direto neste empreendimento (Plano 12b)
  const manifesto = await (await request.get(`${link}/app.webmanifest`)).json();
  expect(manifesto).toMatchObject({ start_url: new URL(link).pathname, scope: new URL(link).pathname, display: 'standalone', name: 'Residencial Aurora em 3D' });
  expect((await request.get(`${new URL(link).origin}/v/token-que-nao-existe-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/app.webmanifest`)).status()).toBe(404);
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
  // o card da unidade fala com o corretor no WhatsApp, com a unidade já na mensagem (Plano 12b)
  await expect(cliente.getByTestId('falar-corretor').getByRole('link')).toHaveAttribute('href', /^https:\/\/wa\.me\/5511977771234\?text=.*unidade%20102/);

  // ao vivo: a gestão reserva a 101 e o cliente vê na hora, sem recarregar
  await expect(vitrine).toHaveAttribute('data-ao-vivo', 'conectado', { timeout: 30_000 });
  await page.getByTestId('unidade-101').click();
  await page.getByLabel('Novo status').selectOption('reservado');
  await page.getByRole('button', { name: 'Mudar status' }).click();
  await expect(page.getByText('Status alterado.')).toBeVisible();
  // 2 s é pouco para o `next dev` do CI (Turbopack sem otimizar, HMR ligado): a entrega do SSE em si é instantânea
  // (LISTEN/NOTIFY do Postgres, sem passar pelo Next), mas o JS da página é bem mais pesado para rodar nesse modo;
  // confirmado: em build de produção (mesma lógica, mesmo SSE) a troca aparece bem dentro de 2 s
  await expect(cliente.getByTestId('lista-vitrine').getByRole('button', { name: /^101/ })).toContainText('Reservado', { timeout: 10_000 });
  await cliente.screenshot({ path: test.info().outputPath('portal-celular.png') });

  await cliente.getByRole('link', { name: /Quero falar com/ }).tap();
  await cliente.getByLabel('Seu nome', { exact: true }).fill('Carla Mendes');
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

  // painel: lead com a unidade e a mensagem. Numa aba nova (processo próprio): a aba do espelho pode estar no meio
  // da atualização depois da mudança de status, e no CI uma navegação nela às vezes ficava presa
  const painel = await page.context().newPage();
  await page.close();
  await painel.goto('/painel/leads', { timeout: 120_000 });
  const lead = painel.getByTestId('lista-leads').getByRole('listitem').filter({ hasText: 'Carla Mendes' });
  await expect(lead).toContainText('unidade 102');
  await expect(lead).toContainText('Posso visitar no sábado?');
  await expect(lead.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/5511977776666');
  await lead.getByLabel('Situação de Carla Mendes').selectOption('em_contato');
  await expect(painel.getByTestId('lista-leads').getByRole('listitem').filter({ hasText: 'Carla Mendes' })).toHaveAttribute('data-status-lead', 'em_contato');

  // números do empreendimento
  await painel.goto(`${projetoUrl}/numeros`);
  await expect
    .poll(
      async () => {
        await painel.reload();
        return `${await painel.getByTestId('numeros-visitas').textContent()}/${await painel.getByTestId('numeros-leads').textContent()}`;
      },
      { timeout: 30_000, intervals: [1_000] },
    )
    .toBe('1/1');
  await expect(painel.getByTestId('numeros-consultoras')).toContainText('Admin E2E');
  await expect(painel.getByTestId('numeros-unidades')).toContainText('102');
  await celular.close();

  // CRM: o webhook do lead chega assinado (o worker entrega), e a API com chave devolve o lead
  await expect.poll(() => recebidos.filter((r) => r.headers['x-imersa-evento'] === 'lead.criado').length, { timeout: 30_000 }).toBe(1);
  const aviso = recebidos.find((r) => r.headers['x-imersa-evento'] === 'lead.criado')!;
  expect(verificarAssinatura(segredo, String(aviso.headers['x-imersa-assinatura']), aviso.corpo)).toBe(true);
  expect(JSON.parse(aviso.corpo).dados).toMatchObject({ nome: 'Carla Mendes', unidade: '102', empreendimento: 'Residencial Aurora' });
  const v1 = await request.get(`${API}/v1/leads`, { headers: { authorization: `Bearer ${chave}` } });
  expect(v1.status()).toBe(200);
  expect(await v1.json()).toEqual([expect.objectContaining({ nome: 'Carla Mendes', telefone: '(11) 97777-6666' })]);
  crm.close();

  // desativar o link: o cliente vê o aviso
  await painel.goBack();
  await painel.goto(projetoUrl);
  await painel.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await painel.getByTestId('lista-links').getByRole('button', { name: 'Desativar' }).click();
  await expect(painel.getByTestId('lista-links').getByRole('listitem').first()).toHaveAttribute('data-status-link', 'revogado');
  const depois = await browser.newPage();
  await depois.goto(link);
  await expect(depois.getByRole('heading', { name: 'Este link não está mais disponível' })).toBeVisible();
  await depois.close();
});
