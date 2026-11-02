import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

const PLANILHA = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre E;1;101;Tipo 2Q;70;2;610.000,00;disponivel', 'Torre E;1;102;Tipo 3Q;98;3;820.000,00;disponivel', 'Torre E;2;201;Tipo 2Q;70;2;640.000,00;vendido'].join('\n');

test('estande: painel cria → PC em tela cheia apresenta sozinho → visitante explora → recomeça → status ao vivo → painel vê online, recarrega e desativa', async ({ page, request, browser }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'estande');
  await page.getByLabel('Nome do projeto').fill('Residencial Horizonte');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Horizonte/ }).click();
  await page.getByLabel('Nome do prédio').fill('Torre E');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();

  // painel: cria o estande; o endereço aparece uma vez, com o atalho do Windows (modo quiosque)
  const secao = page.getByTestId('estandes');
  await secao.getByLabel('Nome do estande').fill('Estande da Paulista');
  await secao.getByRole('button', { name: 'Criar estande' }).click();
  const endereco = (await page.getByTestId('endereco-estande').textContent())!.trim();
  expect(endereco).toMatch(/^http:\/\/localhost:3100\/estande\/[\w-]{43}$/);
  const baixando = page.waitForEvent('download');
  await secao.getByRole('button', { name: 'Baixar atalho para Windows' }).click();
  const atalho = await readFile((await (await baixando).path())!, 'utf8');
  expect(atalho).toContain(`set URL=${endereco}`);
  expect(atalho).toContain('--kiosk');
  expect(atalho).toContain('\r\n');
  await expect(page.getByTestId('lista-estandes').getByRole('listitem').first()).toHaveAttribute('data-status-estande', 'offline');

  // pacote do Unreal: dados do empreendimento e das unidades
  const baixandoPacote = page.waitForEvent('download');
  await secao.getByText('Estande em Unreal Engine').click();
  await secao.getByRole('link', { name: 'Baixar dados (JSON)' }).click();
  const pacote = JSON.parse(await readFile((await (await baixandoPacote).path())!, 'utf8'));
  expect(pacote).toMatchObject({ formato: 'imersa-estande/1', predio: { nome: 'Torre E' } });
  expect(pacote.unidades.map((u: { codigo: string }) => u.codigo)).toEqual(['101', '102', '201']);

  // PC do estande: tela grande com toque, sem login
  const pc = await browser.newContext({ viewport: { width: 1920, height: 1080 }, hasTouch: true });
  // "sem internet" do teste de estande offline (ligado por uma marca na própria página)
  await pc.addInitScript(() => {
    const real = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')!;
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get() { return localStorage.getItem('e2e-sem-rede') === '1' ? false : real.get!.call(this); } });
  });
  const tela = await pc.newPage();
  await tela.goto(`${endereco}?ocioso=12&sinal=6`);
  const estande = tela.getByTestId('estande');
  const vitrine = tela.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 90_000 });
  await expect(tela.getByRole('heading', { name: 'Residencial Horizonte · Torre E' })).toBeVisible();
  await expect(tela.getByTestId('qr-estande')).toHaveAttribute('src', /^data:image\/png;base64,/);
  // ninguém mexendo: apresentação automática com uma unidade disponível de cada vez
  await expect(estande).toHaveAttribute('data-apresentacao', 'ligada');
  await expect(vitrine).toHaveAttribute('data-apresentacao', 'ligada');
  await expect(tela.getByTestId('apresentacao-unidade')).toContainText(/Unidade 10[12]/);
  await expect(tela.getByTestId('apresentacao-unidade')).not.toContainText('201'); // vendida não aparece
  await tela.screenshot({ path: test.info().outputPath('estande-apresentacao.png') });

  // visitante toca: a apresentação sai, ele escolhe unidade e clima
  await tela.getByTestId('lista-vitrine').getByRole('button', { name: /^102/ }).tap();
  await expect(estande).toHaveAttribute('data-apresentacao', 'desligada');
  await expect(tela.getByTestId('apresentacao-unidade')).toHaveCount(0);
  await expect(tela.getByRole('heading', { name: 'Unidade 102' })).toBeVisible();
  await tela.getByRole('button', { name: 'Nublado' }).tap();
  await expect(vitrine).toHaveAttribute('data-clima', 'nublado');
  await tela.screenshot({ path: test.info().outputPath('estande-visitante.png') });
  // a coluna rola sozinha: o cabeçalho com o QR continua na tela; número técnico de FPS não aparece para o visitante
  await expect(tela.getByTestId('qr-estande')).toBeInViewport();
  await expect(tela.getByTestId('qualidade')).toHaveCount(0);

  // foi embora: depois do tempo ocioso, volta a apresentar e recomeça do zero para o próximo
  await expect(estande).toHaveAttribute('data-apresentacao', 'ligada', { timeout: 25_000 });
  await expect(estande).toHaveAttribute('data-reinicio', /^[1-9]\d*$/);
  await expect(tela.getByRole('heading', { name: 'Unidade 102' })).toHaveCount(0);
  await expect(vitrine).toHaveAttribute('data-clima', 'limpo');

  // venda feita no painel aparece no estande na hora
  await expect(vitrine).toHaveAttribute('data-ao-vivo', 'conectado', { timeout: 30_000 });
  await page.getByTestId('unidade-101').click();
  await page.getByLabel('Novo status').selectOption('reservado');
  await page.getByRole('button', { name: 'Mudar status' }).click();
  await expect(page.getByText('Status alterado.')).toBeVisible();
  await expect(tela.getByTestId('lista-vitrine').getByRole('button', { name: /^101/ })).toContainText('Reservado', { timeout: 5_000 });

  // painel: online, com o desempenho da tela e o visitante contado
  const item = page.getByTestId('lista-estandes').getByRole('listitem').first();
  await expect
    .poll(
      async () => {
        await page.reload();
        return `${await item.getAttribute('data-status-estande')}/${await item.getByTestId('interacoes-estande').textContent()}`;
      },
      { timeout: 30_000, intervals: [2_000] },
    )
    .toMatch(/^online\/[1-9]\d*$/); // com o 3D por software, o visitante pode ter saído e voltado (recomeço)
  await expect(item).toContainText('tela 1920×1080');

  // recarregar à distância: o PC recarrega no próximo sinal
  await tela.evaluate(() => ((window as unknown as { antes: boolean }).antes = true));
  await item.getByRole('button', { name: 'Recarregar' }).click();
  await tela.waitForFunction(() => !(window as unknown as { antes?: boolean }).antes, undefined, { timeout: 30_000 });
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 90_000 });

  // estande offline: o PC já guardou página, código e 3D; sem internet, recarregar (como na recarga das 12 h) abre
  // o 3D do guardado, com o aviso de dados possivelmente desatualizados
  await expect(tela.getByTestId('estande')).toHaveAttribute('data-offline', 'pronto');
  // internet caída: todo pedido do PC falha (também os do service worker, que cai no guardado) e o aparelho se vê
  // sem rede. Só a conexão de recarga do Next (que só existe no modo de desenvolvimento) não passa por aqui.
  const cair = (r: import('@playwright/test').Route) => r.abort('internetdisconnected');
  await pc.route('**/*', cair);
  await tela.evaluate(() => localStorage.setItem('e2e-sem-rede', '1'));
  const semRede = await tela.reload();
  expect(semRede?.fromServiceWorker()).toBe(true);
  // a página guardada só "acorda" (hidrata) no site de produção: o servidor de desenvolvimento do Next não hidrata
  // uma página entregue sem ele. Conferido com E2E_PRODUCAO=1 (E2E_SEM_BUILD=1 em máquina com pouca memória)
  if (process.env.E2E_PRODUCAO === '1') {
    await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 90_000 });
    await expect(tela.getByText('Sem internet: os dados podem estar desatualizados')).toBeVisible();
  }
  await pc.unroute('**/*', cair);
  await tela.evaluate(() => localStorage.removeItem('e2e-sem-rede'));
  await tela.reload();
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 90_000 });
  await expect(tela.getByText('Sem internet: os dados podem estar desatualizados')).toBeHidden();

  // desativar: confirmação em dois passos; o PC mostra o aviso no próximo sinal
  await item.getByRole('button', { name: 'Desativar' }).click();
  await item.getByRole('button', { name: 'Confirmar desativação' }).click();
  await expect(page.getByTestId('lista-estandes').getByRole('listitem').first()).toHaveAttribute('data-status-estande', 'desativado');
  await expect(tela.getByTestId('estande-desativado')).toBeVisible({ timeout: 30_000 });
  await pc.close();
});
