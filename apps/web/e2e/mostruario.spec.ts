import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { codigoTotp } from '../../api/src/auth/totp';
import { API, entrarComoAdminComMfa } from './ajuda';

/**
 * Mostruário (Plano 12): monta um empreendimento de demonstração completo e salva capturas de tela em alta
 * qualidade para o dono do produto revisar. NÃO roda no CI: só a pedido, com MOSTRUARIO=1 (de preferência também
 * E2E_GPU=1 E2E_PRODUCAO=1, para ver a placa de vídeo real e o build de produção). Dividido em 4 testes (um
 * empreendimento cada) para poder rodar um de cada vez numa máquina com pouca memória, com `--grep`.
 */
const PASTA = process.env.PASTA_CAPTURAS ?? fileURLToPath(new URL('../test-results/mostruario', import.meta.url));
mkdirSync(PASTA, { recursive: true });

interface Legenda {
  arquivo: string;
  titulo: string;
  descricao: string;
}
/** Acrescenta (ou substitui) uma legenda no legendas.json, sem apagar as de outros testes já rodados. */
function registrarLegenda(l: Legenda) {
  const caminho = `${PASTA}/legendas.json`;
  const atuais: Legenda[] = existsSync(caminho) ? JSON.parse(readFileSync(caminho, 'utf8')) : [];
  const resto = atuais.filter((x) => x.arquivo !== l.arquivo);
  resto.push(l);
  resto.sort((a, b) => a.arquivo.localeCompare(b.arquivo));
  writeFileSync(caminho, JSON.stringify(resto, null, 2));
}
/** Captura a tela inteira (resolução do viewport) e já grava a legenda em pt-BR. */
async function capturar(pagina: Page, arquivo: string, titulo: string, descricao: string) {
  await pagina.screenshot({ path: `${PASTA}/${arquivo}` });
  registrarLegenda({ arquivo, titulo, descricao });
}
/** Rola para o topo e dá tempo para o 3D assentar (câmera, sombras, nuvens) antes de capturar. */
async function assentar(pagina: Page, ms = 1800) {
  await pagina.evaluate(() => window.scrollTo(0, 0));
  await pagina.waitForTimeout(ms);
}
/** Vai para a Vitrine com ?qualidade=alto (céu, reflexos e acabamento de imagem) e espera o 3D ficar pronto. */
async function abrirEmAlta(pagina: Page) {
  const url = new URL(pagina.url());
  url.searchParams.set('qualidade', 'alto');
  await pagina.goto(url.toString());
  const vitrine = pagina.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await expect(vitrine).toHaveAttribute('data-acabamento', 'ligado', { timeout: 30_000 });
  return vitrine;
}

const FOTO = readFileSync(new URL('./fixtures/video-fzk-capa.jpg', import.meta.url));
const LAT_PAULISTA = '-23.56175';
const LON_PAULISTA = '-46.6545';

const PLANILHA_TORRE = [
  'predio;andar;codigo;tipologia;area_m2;quartos;preco;status',
  'Torre Imersa;1;101;Tipo 2Q;70;2;650.000,00;disponivel',
  'Torre Imersa;1;102;Tipo 3Q;98;3;920.000,00;disponivel',
  'Torre Imersa;1;103;Tipo 2Q;70;2;660.000,00;reservado',
  'Torre Imersa;1;104;Tipo 3Q;98;3;930.000,00;vendido',
  'Torre Imersa;2;201;Tipo 2Q;70;2;670.000,00;disponivel',
  'Torre Imersa;2;202;Tipo 3Q;98;3;940.000,00;disponivel',
  'Torre Imersa;2;203;Tipo 2Q;70;2;680.000,00;disponivel',
  'Torre Imersa;2;204;Tipo 3Q;98;3;950.000,00;reservado',
  'Torre Imersa;3;301;Tipo 2Q;70;2;690.000,00;disponivel',
  'Torre Imersa;3;302;Tipo 3Q;98;3;960.000,00;disponivel',
  'Torre Imersa;3;303;Tipo 2Q;70;2;700.000,00;vendido',
  'Torre Imersa;3;304;Tipo 3Q;98;3;970.000,00;disponivel',
].join('\n');

test('mostruario 1/4: Torre Imersa — dia, noite, pôr do sol, filtro, andares, planta, a pé, proximidades, lazer, galeria', async ({ page, request }) => {
  test.skip(!process.env.MOSTRUARIO, 'só roda a pedido (MOSTRUARIO=1): gera capturas de demonstração em test-results/mostruario');
  test.setTimeout(20 * 60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });

  const conta = await entrarComoAdminComMfa(page, request, 'mostruario');
  await page.getByLabel('Nome do projeto').fill('Residencial Imersa');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Imersa/ }).click();
  await page.getByLabel('Latitude').fill(LAT_PAULISTA);
  await page.getByLabel('Longitude').fill(LON_PAULISTA);
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(page.getByText('Dados salvos.')).toBeVisible();
  const projetoId = new URL(page.url()).pathname.split('/').at(-1)!;

  // ponto real perto do empreendimento, para a rota a pé do "O que há perto" (item 9)
  await page.waitForTimeout(30_500 - (Date.now() % 30_000)); // o código de 6 dígitos não vale duas vezes: espera o próximo
  const entrada = await request.post(`${API}/auth/login`, { data: { email: conta.email, senha: conta.senha, empresa: conta.empresa, codigoMfa: codigoTotp(conta.segredo) } });
  const { acesso } = await entrada.json();
  await request.post(`${API}/projetos/${projetoId}/pois`, {
    headers: { authorization: `Bearer ${acesso}` },
    data: { categoria: 'transporte', nome: 'Estação Trianon-MASP', lat: -23.5614, lon: -46.6564 },
  });

  await page.getByLabel('Nome do prédio').fill('Torre Imersa');
  await page.getByLabel('Andares').fill('3');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA_TORRE);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await expect(page.getByText('Prévia (nada foi gravado).')).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();

  // uma foto do projeto: vira foto da piscina, foto da galeria e logo da marca
  const declarado = await request.post(`${API}/projetos/${projetoId}/arquivos`, { headers: { authorization: `Bearer ${acesso}` }, data: { nome: 'Fachada Imersa.jpg', tipo: 'imagem', tamanho: FOTO.length } });
  const { envio } = await declarado.json();
  await request.put(envio.url, { headers: { 'content-type': 'application/octet-stream' }, data: FOTO });

  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  // link do cliente (com o WhatsApp do corretor, para o card da unidade no portal — item 4)
  await page.getByLabel('Para quem (opcional)').fill('Cliente Demonstração');
  await page.getByLabel('Seu WhatsApp (opcional)').fill('(11) 98888-1234');
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const linkCliente = (await page.getByTestId('link-cliente').textContent())!.trim();

  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  let vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });

  // marca os espaços de lazer (um deles com a foto do projeto, para a ficha com foto do item 10)
  const cartaoLazer = page.getByTestId('lazer');
  const marcar = async (tipo: string, nome: string, descricao: string, fx: number, foto?: string) => {
    await cartaoLazer.getByLabel('Tipo').selectOption({ label: tipo });
    await cartaoLazer.getByLabel('Nome do espaço').fill(nome);
    await cartaoLazer.getByLabel('Descrição (opcional)').fill(descricao);
    if (foto) await cartaoLazer.getByLabel(foto).check();
    await cartaoLazer.getByRole('button', { name: 'Marcar no 3D' }).click();
    await expect(vitrine).toHaveAttribute('data-marcando-lazer', 'sim');
    await vitrine.scrollIntoViewIfNeeded();
    const caixa = (await vitrine.boundingBox())!;
    await page.mouse.click(caixa.x + caixa.width * fx, caixa.y + caixa.height * 0.9);
    await expect(vitrine).toHaveAttribute('data-marcando-lazer', '');
  };
  await marcar('Piscina', 'Piscina Imersa', 'Piscina aquecida com borda infinita', 0.1, 'Fachada Imersa.jpg');
  await marcar('Academia', 'Academia Imersa', 'Equipamentos de última geração, aberta 24h', 0.9);
  await marcar('Playground', 'Playground Imersa', 'Piso emborrachado e brinquedos novos', 0.3);
  await expect(vitrine).toHaveAttribute('data-lazer', '3');

  // galeria do empreendimento (item 11)
  const gestaoGaleria = page.getByTestId('gestao-galeria');
  await gestaoGaleria.getByLabel('Adicionar foto do projeto').selectOption({ label: 'Fachada Imersa.jpg' });
  await gestaoGaleria.getByRole('button', { name: 'Salvar galeria' }).click();
  await expect(page.getByTestId('galeria').getByRole('button')).toHaveCount(1, { timeout: 15_000 });
  const urlVitrineAdmin = page.url();

  // marca da incorporadora (cor e logo), para aparecer no portal do cliente (item 12)
  await page.goto('/painel/marca');
  await page.getByLabel('Cor primária').evaluate((el: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, '#16a34a');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const seletorLogo = page.getByLabel('Logo (foto já enviada no projeto)');
  await expect(seletorLogo.locator('option', { hasText: 'Fachada Imersa.jpg' })).toHaveCount(1, { timeout: 15_000 });
  await seletorLogo.selectOption({ label: 'Fachada Imersa.jpg' });
  await page.getByRole('button', { name: 'Salvar marca' }).click();
  await expect(page.getByText('Marca salva.')).toBeVisible();

  // de volta à Vitrine da gestão, em qualidade alta, para as capturas do prédio
  await page.goto(urlVitrineAdmin);
  vitrine = await abrirEmAlta(page);
  await expect(vitrine).toHaveAttribute('data-entorno', /^\d+$/, { timeout: 45_000 });
  // equinócio (dia e noite quase iguais, pôr do sol por volta das 18h em SP): no solstício de inverno (21/06) o sol já
  // se põe perto das 17h30, e a hora ~17h45 pedida ficaria igual à da noite (escuro demais, sem o tom dourado)
  await page.getByLabel('Dia do sol').fill('2026-09-23');

  // 1. visão geral de dia
  await page.getByLabel(/^Hora/).fill('11');
  await assentar(page);
  await capturar(page, '01-vitrine-dia-geral.png', 'Vista geral de dia', 'O prédio com a cidade ao redor, carros na rua, nuvens no céu e árvores (ipê e palmeira).');

  // 2. a mesma vista à noite
  await page.getByLabel(/^Hora/).fill('21');
  await assentar(page, 2200);
  await capturar(page, '02-vitrine-noite.png', 'A mesma vista à noite', 'Janelas acesas nas unidades disponíveis e faróis dos carros, com o céu escuro.');

  // 3. pôr do sol
  await page.getByLabel(/^Hora/).fill('17.75');
  await assentar(page, 2200);
  await capturar(page, '03-vitrine-por-do-sol.png', 'Pôr do sol', 'Luz dourada do fim de tarde, por volta das 17h45.');
  await page.getByLabel(/^Hora/).fill('11');

  // 5. vista explodida dos andares
  await page.getByRole('button', { name: 'Separar os andares' }).click();
  await expect(vitrine).toHaveAttribute('data-explosao', '1', { timeout: 15_000 });
  await assentar(page);
  await capturar(page, '05-vista-explodida.png', 'Vista explodida dos andares', 'Os andares se separam para mostrar a estrutura do prédio, um sobre o outro.');
  await page.getByRole('button', { name: 'Juntar os andares' }).click();
  await expect(vitrine).toHaveAttribute('data-explosao', '0', { timeout: 15_000 });

  // 6. casa de bonecas
  await page.getByLabel('Ver até o andar (corte)').selectOption({ label: '1º andar' });
  await page.getByRole('button', { name: /^(Casa de bonecas|Sair da casa de bonecas)$/ }).click();
  await expect(vitrine).toHaveAttribute('data-casa-bonecas', '1', { timeout: 15_000 });
  await assentar(page);
  await capturar(page, '06-casa-de-bonecas.png', 'Casa de bonecas', 'Corte do 1º andar mostrando as paredes de cada apartamento, pintadas pela situação (disponível, reservado, vendido).');

  // 7. planta 3D humanizada (sai sozinho da casa de bonecas: os dois modos são exclusivos)
  await page.getByTestId('secoes').getByRole('button', { name: /^(Planta|Voltar ao 3D)$/ }).click();
  await expect(vitrine).toHaveAttribute('data-planta', 'sim', { timeout: 15_000 });
  await assentar(page);
  await capturar(page, '07-planta-3d-humanizada.png', 'Planta 3D humanizada', 'Vista de cima do andar, mobiliado, como uma planta baixa em 3D.');
  await page.getByTestId('secoes').getByRole('button', { name: /^(Planta|Voltar ao 3D)$/ }).click();
  await expect(vitrine).toHaveAttribute('data-planta', 'nao', { timeout: 15_000 });
  await page.getByLabel('Ver até o andar (corte)').selectOption({ label: 'Prédio inteiro' });

  // 8. primeira pessoa / boneco na rua
  await page.getByRole('button', { name: 'Andar a pé (1ª pessoa)' }).click();
  await expect(vitrine).toHaveAttribute('data-modo', 'primeira-pessoa', { timeout: 15_000 });
  await vitrine.click({ position: { x: 20, y: 20 } }); // foco no 3D, para o teclado valer
  await page.keyboard.down('s'); // anda para trás, até a calçada/rua
  await page.waitForTimeout(1500);
  await page.keyboard.up('s');
  const jogo = page.getByTestId('modo-jogo');
  await jogo.getByLabel('Ver o boneco (3ª pessoa)').check();
  await expect(vitrine).toHaveAttribute('data-terceira', 'sim', { timeout: 10_000 });
  await jogo.getByRole('combobox', { name: 'Boneco' }).selectOption('beto');
  await assentar(page);
  await capturar(page, '08-primeira-pessoa-boneco.png', 'Primeira pessoa com o boneco na rua', 'Passeio a pé: o boneco andando na rua, na altura de uma pessoa de verdade, com o prédio atrás.');
  await page.getByRole('button', { name: 'Voltar para a vista de cima' }).click();
  await expect(vitrine).toHaveAttribute('data-modo', 'orbita', { timeout: 10_000 });

  // 9. proximidades com a rota a pé
  await page.getByTestId('secoes').getByRole('button', { name: 'O que há perto' }).click();
  const perto = page.getByTestId('proximidades');
  await expect(perto).toContainText('Estação Trianon-MASP', { timeout: 30_000 });
  await perto.getByRole('group', { name: 'Tipo de lugar' }).getByRole('button', { name: 'Transporte' }).click();
  await perto.getByRole('button', { name: /Estação Trianon-MASP/ }).click();
  await expect(vitrine).toHaveAttribute('data-rota', /^[1-9]/, { timeout: 15_000 });
  await assentar(page);
  await capturar(page, '09-proximidades-rota.png', 'Proximidades com a rota a pé', 'A rota a pé até a estação de metrô mais perto, desenhada no chão pelas ruas reais.');

  // 10. carrossel das áreas comuns + ficha com foto
  await page.getByTestId('secoes').getByRole('button', { name: 'Áreas comuns' }).click();
  const carrossel = page.getByTestId('carrossel-lazer');
  await carrossel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await capturar(page, '10-carrossel-areas-comuns.png', 'Carrossel das áreas comuns', 'Cada espaço de lazer marcado aparece num cartão; tocar nele voa a câmera até lá.');
  await carrossel.getByTestId('carrossel-item').first().click();
  const painelLazer = page.getByTestId('tour-lazer');
  await expect(painelLazer).toHaveAttribute('data-tour', 'ponto');
  await painelLazer.getByTestId('ficha-fotos').getByRole('button').click();
  const lightboxLazer = page.getByTestId('galeria-lightbox');
  await expect(lightboxLazer).toBeVisible();
  await page.waitForTimeout(400);
  await capturar(page, '11-ficha-area-comum.png', 'Ficha da área comum, com foto', 'Ao tocar na Piscina, a ficha mostra a descrição e a foto escolhida, em tela cheia.');
  await lightboxLazer.getByRole('button', { name: 'Fechar' }).click();
  await painelLazer.getByRole('button', { name: 'Fechar' }).click();

  // 12. galeria do empreendimento em tela cheia
  await page.getByTestId('secoes').getByRole('button', { name: 'Galeria' }).click();
  await page.getByTestId('galeria').getByRole('button').first().click();
  const lightboxGaleria = page.getByTestId('galeria-lightbox');
  await expect(lightboxGaleria).toBeVisible();
  await expect(page.getByTestId('galeria-contador')).toHaveText('1 de 1');
  await page.waitForTimeout(400);
  await capturar(page, '12-galeria-tela-cheia.png', 'Galeria em tela cheia', 'As fotos do empreendimento em tela cheia, com o contador "1 de N".');
  await lightboxGaleria.getByRole('button', { name: 'Fechar' }).click();

  // 4. filtro de unidades com etiquetas + card com o WhatsApp do corretor (só existe no portal do cliente,
  // onde o link carrega o corretor; a Vitrine da gestão não mostra este card)
  await page.goto(linkCliente);
  const vitrineCliente = page.getByTestId('vitrine-3d');
  await expect(vitrineCliente).toHaveAttribute('data-estado', 'pronto', { timeout: 90_000 });
  // sem ?qualidade= no portal (só existe na Vitrine da gestão): espera a cidade carregar e a qualidade adaptativa
  // subir com a GPU real; sem isto o canvas pode sair em branco (o 1º quadro de verdade ainda não foi desenhado)
  await expect(vitrineCliente).toHaveAttribute('data-entorno', /^\d+$/, { timeout: 45_000 });
  await page.waitForTimeout(5000);
  await page.getByLabel('3 quartos').check();
  await expect(vitrineCliente).toHaveAttribute('data-etiquetas', '6', { timeout: 30_000 });
  await page.getByTestId('lista-vitrine').getByRole('button', { name: /^202/ }).click();
  await expect(page.getByRole('heading', { name: 'Unidade 202' })).toBeVisible();
  await assentar(page, 3000);
  await capturar(page, '04-filtro-unidades-corretor.png', 'Filtro de unidades e card do corretor', 'Só as unidades de 3 quartos ficam com a etiqueta "Apto ..."; a unidade escolhida mostra o card com o botão para falar com o corretor no WhatsApp.');
});

test('mostruario 2a/4: portal do cliente no celular, com a marca da incorporadora', async ({ page, request, browser }) => {
  test.skip(!process.env.MOSTRUARIO, 'só roda a pedido (MOSTRUARIO=1): gera capturas de demonstração em test-results/mostruario');
  test.setTimeout(20 * 60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });

  const conta = await entrarComoAdminComMfa(page, request, 'mostruario-portal');
  await page.getByLabel('Nome do projeto').fill('Residencial Imersa Celular');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Imersa Celular/ }).click();
  await page.getByLabel('Latitude').fill(LAT_PAULISTA);
  await page.getByLabel('Longitude').fill(LON_PAULISTA);
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(page.getByText('Dados salvos.')).toBeVisible();
  const projetoId = new URL(page.url()).pathname.split('/').at(-1)!;

  await page.getByLabel('Nome do prédio').fill('Torre Imersa');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre Imersa;1;101;Tipo 2Q;70;2;650.000,00;disponivel', 'Torre Imersa;1;102;Tipo 3Q;98;3;920.000,00;disponivel', 'Torre Imersa;2;201;Tipo 2Q;70;2;670.000,00;reservado'].join('\n'));
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();

  // uma foto do projeto: vira o logo da marca
  await page.waitForTimeout(30_500 - (Date.now() % 30_000)); // o código de 6 dígitos não vale duas vezes: espera o próximo
  const entrada = await request.post(`${API}/auth/login`, { data: { email: conta.email, senha: conta.senha, empresa: conta.empresa, codigoMfa: codigoTotp(conta.segredo) } });
  const { acesso } = await entrada.json();
  const declarado = await request.post(`${API}/projetos/${projetoId}/arquivos`, { headers: { authorization: `Bearer ${acesso}` }, data: { nome: 'Logo Imersa.jpg', tipo: 'imagem', tamanho: FOTO.length } });
  const { envio } = await declarado.json();
  await request.put(envio.url, { headers: { 'content-type': 'application/octet-stream' }, data: FOTO });

  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByLabel('Para quem (opcional)').fill('Cliente Demonstração');
  await page.getByLabel('Seu WhatsApp (opcional)').fill('(11) 97777-5678');
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const linkCliente = (await page.getByTestId('link-cliente').textContent())!.trim();

  // marca da incorporadora (cor azul + o logo enviado acima)
  await page.goto('/painel/marca');
  await page.getByLabel('Cor primária').evaluate((el: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, '#2563eb');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const seletorLogo = page.getByLabel('Logo (foto já enviada no projeto)');
  await expect(seletorLogo.locator('option', { hasText: 'Logo Imersa.jpg' })).toHaveCount(1, { timeout: 15_000 });
  await seletorLogo.selectOption({ label: 'Logo Imersa.jpg' });
  await page.getByRole('button', { name: 'Salvar marca' }).click();
  await expect(page.getByText('Marca salva.')).toBeVisible();

  // 13. portal do cliente no celular, com a marca
  const celular = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cliente = await celular.newPage();
  await cliente.goto(linkCliente);
  const vitrineCliente = cliente.getByTestId('vitrine-3d');
  await expect(vitrineCliente).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
  await expect(vitrineCliente).toHaveAttribute('data-entorno', /^\d+$/, { timeout: 45_000 });
  await cliente.waitForTimeout(5000); // sem ?qualidade= no portal: dá tempo da qualidade adaptativa subir com a GPU real
  await cliente.getByTestId('lista-vitrine').getByRole('button', { name: /^102/ }).tap();
  await expect(cliente.getByRole('heading', { name: 'Unidade 102' })).toBeVisible();
  await assentar(cliente);
  await capturar(cliente, '13-portal-cliente-celular.png', 'Portal do cliente no celular', 'O mesmo 3D no celular do comprador, já com a cor e o logo da incorporadora, e o card para falar com o corretor no WhatsApp.');
  await cliente.close();
  await celular.close();
});

// Teste à parte (Plano 12): divide a memória entre 2 testes menores — o portal acima já abre um 2º contexto (o
// celular) com sua própria cena 3D; o estande abaixo abre outro. Rodar os dois juntos, nesta máquina, é o que mais
// pesa no mostruário inteiro (o site de produção chegou a sair por falta de memória com os dois num teste só).
test('mostruario 2b/4: estande em apresentação automática', async ({ page, request, browser }) => {
  test.skip(!process.env.MOSTRUARIO, 'só roda a pedido (MOSTRUARIO=1): gera capturas de demonstração em test-results/mostruario');
  test.setTimeout(20 * 60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });

  await entrarComoAdminComMfa(page, request, 'mostruario-estande');
  await page.getByLabel('Nome do projeto').fill('Residencial Imersa Estande');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Imersa Estande/ }).click();
  await page.getByLabel('Nome do prédio').fill('Torre Imersa');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre Imersa;1;101;Tipo 2Q;70;2;650.000,00;disponivel', 'Torre Imersa;1;102;Tipo 3Q;98;3;920.000,00;disponivel', 'Torre Imersa;2;201;Tipo 2Q;70;2;670.000,00;vendido'].join('\n'));
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();

  // 14. estande em apresentação automática
  const secao = page.getByTestId('estandes');
  await secao.getByLabel('Nome do estande').fill('Estande Imersa');
  await secao.getByRole('button', { name: 'Criar estande' }).click();
  const endereco = (await page.getByTestId('endereco-estande').textContent())!.trim();
  const pc = await browser.newContext({ viewport: { width: 1600, height: 1000 }, hasTouch: true });
  const tela = await pc.newPage();
  await tela.goto(`${endereco}?ocioso=9999`);
  const vitrineEstande = tela.getByTestId('vitrine-3d');
  await expect(vitrineEstande).toHaveAttribute('data-estado', 'pronto', { timeout: 90_000 });
  await expect(tela.getByTestId('apresentacao-unidade')).toContainText(/Unidade \d{3}/, { timeout: 15_000 });
  await assentar(tela);
  await capturar(tela, '14-estande-apresentacao.png', 'Estande em apresentação automática', 'Tela do estande (PC em modo quiosque) apresentando sozinha as unidades disponíveis, para quem passa em frente.');
  await pc.close();
});

/**
 * DXF do parcelamento (igual ao de e2e/visual.spec.ts e e2e/loteamento.spec.ts): 3 quadras de 3 lotes de 12×30 m,
 * perto do centro do projeto (Av. Paulista), com rua/calçada/meio-fio do lado leste (item 8 do Plano 12d).
 */
function dxfLoteamentoMostruario(): string {
  const poli = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '1', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
  const linha = (camada: string, pts: Array<[number, number]>) => ['0', 'LWPOLYLINE', '8', camada, '90', String(pts.length), '70', '0', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])];
  const texto = (camada: string, x: number, y: number, t: string) => ['0', 'TEXT', '8', camada, '10', String(x), '20', String(y), '40', '1.5', '1', t];
  const e: string[] = [];
  const [x0, y0] = [331_120, 7_393_250];
  for (const [q, dy] of [[1, 0], [2, 50], [3, 100]] as const) {
    e.push(...poli('QUADRAS', [[x0 - 2, y0 + dy - 2], [x0 + 38, y0 + dy - 2], [x0 + 38, y0 + dy + 32], [x0 - 2, y0 + dy + 32]]), ...texto('QUADRAS', x0 + 30, y0 + dy + 31, `Q-${q}`));
    for (let l = 0; l < 3; l++) {
      const x = x0 + l * 12;
      e.push(...poli('LOTES', [[x, y0 + dy], [x + 12, y0 + dy], [x + 12, y0 + dy + 30], [x, y0 + dy + 30]]), ...texto('NUMEROS', x + 6, y0 + dy + 15, String(l + 1)));
    }
  }
  e.push(...linha('CALCADAS', [[x0 + 37.5, y0 - 5], [x0 + 37.5, y0 + 135]]));
  e.push(...linha('MEIO_FIO', [[x0 + 39, y0 - 5], [x0 + 39, y0 + 135]]));
  e.push(...linha('RUAS', [[x0 + 41, y0 - 5], [x0 + 41, y0 + 135]]));
  return ['0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

test('mostruario 3/4: loteamento — lotes na cidade, buscador, card do lote, casa-modelo e daqui a 10 anos', async ({ page, request }) => {
  test.skip(!process.env.MOSTRUARIO, 'só roda a pedido (MOSTRUARIO=1): gera capturas de demonstração em test-results/mostruario');
  test.setTimeout(20 * 60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });

  await entrarComoAdminComMfa(page, request, 'mostruario-loteamento');
  await page.getByLabel('Nome do projeto').fill('Reserva Imersa');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Reserva Imersa/ }).click();
  await page.getByLabel('Latitude').fill(LAT_PAULISTA);
  await page.getByLabel('Longitude').fill(LON_PAULISTA);
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(page.getByText('Dados salvos.')).toBeVisible();

  await page.getByLabel('Nome do prédio').fill('Loteamento');
  await page.getByLabel('Andares').fill('1');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  let vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });

  // o clube do loteamento: marcado como "lazer" na própria Vitrine, para o card do lote mostrar a distância a pé
  const cartaoLazer = page.getByTestId('lazer');
  await cartaoLazer.getByLabel('Tipo').selectOption({ label: 'Salão de festas' });
  await cartaoLazer.getByLabel('Nome do espaço').fill('Clube Social Imersa');
  await cartaoLazer.getByLabel('Descrição (opcional)').fill('Salão de festas, piscina e quadra do loteamento');
  await cartaoLazer.getByRole('button', { name: 'Marcar no 3D' }).click();
  await expect(vitrine).toHaveAttribute('data-marcando-lazer', 'sim');
  const caixaLazer = (await vitrine.boundingBox())!;
  await page.mouse.click(caixaLazer.x + caixaLazer.width * 0.5, caixaLazer.y + caixaLazer.height * 0.6);
  await expect(vitrine).toHaveAttribute('data-marcando-lazer', '');
  await expect(vitrine).toHaveAttribute('data-lazer', '1');

  const importar = page.getByTestId('importar-lotes');
  await importar.getByLabel('Arquivo do loteamento').setInputFiles({ name: 'reserva-imersa.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxfLoteamentoMostruario()) });
  await importar.getByRole('button', { name: 'Ver a prévia' }).click();
  await expect(page.getByTestId('previa-lotes')).toContainText('Prévia (nada foi gravado): 9 lotes em 3 quadras');
  await importar.getByRole('button', { name: 'Gravar os lotes' }).click();
  await expect(page.getByTestId('previa-lotes')).toContainText('Gravado: 9 lotes');

  vitrine = await abrirEmAlta(page);
  await expect(vitrine).toHaveAttribute('data-lotes', '9', { timeout: 30_000 });
  await expect(vitrine).toHaveAttribute('data-entorno', /^\d+$/, { timeout: 45_000 });
  await expect(vitrine).toHaveAttribute('data-anos', '10', { timeout: 15_000 });
  await page.getByLabel('Dia do sol').fill('2026-06-21');
  await page.getByLabel(/^Hora/).fill('11');

  // 15. visão geral do loteamento: lotes na cidade, com grama, rua e árvores já crescidas
  await assentar(page);
  await capturar(page, '15-loteamento-geral.png', 'Loteamento na cidade', 'Os lotes no chão, com grama, rua, calçada e árvores (já crescidas), dentro da cidade real em volta.');

  // 14b. buscador de lotes: varredura em ciano ao filtrar por quadra
  const busca = page.getByTestId('buscador-lotes');
  await busca.getByRole('group', { name: 'Quadras' }).getByRole('button', { name: '02' }).click();
  await expect(vitrine).toHaveAttribute('data-varredura', 'sim', { timeout: 5_000 }).catch(() => null);
  await capturar(page, '16-buscador-varredura-ciano.png', 'Buscador de lotes', 'Ao filtrar por quadra, um anel ciano varre os lotes que combinam com a busca.');
  await expect(vitrine).toHaveAttribute('data-varredura', 'nao', { timeout: 10_000 });
  await expect(busca.getByTestId('contagem-lotes')).toHaveText('3 de 9 lotes');

  // 17. card do lote: sol e distância ao clube
  await busca.getByTestId('lista-lotes').getByRole('button', { name: /Q02 · L01/ }).click();
  const card = page.getByTestId('lote-selecionado');
  await expect(card).toContainText('Até o clube', { timeout: 15_000 });
  await assentar(page);
  await capturar(page, '17-card-do-lote.png', 'Card do lote', 'Área, frente × fundo, preço, para onde o sol bate e a distância a pé até o clube do loteamento.');

  // 18. casa-modelo no lote e vista a 1,60 m (os dois juntos: a casa aparece e a câmera desce para a calçada)
  await card.getByTestId('casa-modelo').click();
  await expect(vitrine).toHaveAttribute('data-casa-modelo', /.+/, { timeout: 15_000 });
  await card.getByTestId('ver-daqui').click();
  await expect(vitrine).toHaveAttribute('data-vista-lote', /.+/, { timeout: 15_000 });
  await assentar(page);
  await capturar(page, '18-casa-modelo-vista-1-60m.png', 'Casa-modelo no lote, vista a 1,60 m', 'A casa-modelo já nas medidas do lote, vista da calçada, na altura dos olhos de uma pessoa.');

  // 19 e 20. daqui a 10 anos: árvores recém-plantadas × árvores crescidas
  const controle = page.getByTestId('daqui-a-10-anos').getByLabel(/Árvores do loteamento/);
  await controle.focus();
  await controle.press('Home');
  await expect(vitrine).toHaveAttribute('data-anos', '0', { timeout: 10_000 });
  await assentar(page);
  await capturar(page, '19-loteamento-recem-plantado.png', 'Loteamento recém-plantado', 'No dia zero: grama e árvores acabadas de plantar.');
  await controle.press('End');
  await expect(vitrine).toHaveAttribute('data-anos', '10', { timeout: 10_000 });
  await assentar(page);
  await capturar(page, '20-loteamento-daqui-a-10-anos.png', 'Daqui a 10 anos', 'As mesmas árvores, dez anos depois: o loteamento com a vegetação já crescida.');
});

test('mostruario 4/4: BIM — casa FZK real convertida no 3D', async ({ page, request }) => {
  test.skip(!process.env.MOSTRUARIO, 'só roda a pedido (MOSTRUARIO=1): gera capturas de demonstração em test-results/mostruario');
  test.setTimeout(20 * 60_000);
  await page.setViewportSize({ width: 1600, height: 1000 });

  const FZK = fileURLToPath(new URL('../../../exemplos/projeto-bim/AC20-FZK-Haus.ifc', import.meta.url));
  const PLANILHA_BIM = ['predio;andar;codigo;status', ...[1, 2, 3, 4, 5, 6].map((n) => `Casa;1;${n};disponivel`), 'Casa;2;7;disponivel'].join('\n');

  await entrarComoAdminComMfa(page, request, 'mostruario-bim');
  await page.getByLabel('Nome do projeto').fill('Casa Imersa BIM');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Casa Imersa BIM/ }).click();
  await page.getByLabel('Nome do prédio').fill('Casa');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA_BIM);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();

  await page.locator('#tipo-arquivo').selectOption({ label: 'Projeto BIM (.ifc)' });
  await page.locator('#arquivo-envio').setInputFiles(FZK);
  await page.getByRole('button', { name: 'Enviar arquivo' }).click();
  await expect(page.getByText('AC20-FZK-Haus.ifc enviado e verificado.')).toBeVisible({ timeout: 60_000 });

  const item = page.getByTestId('lista-bim').getByRole('listitem').filter({ hasText: 'AC20-FZK-Haus.ifc' });
  await item.getByRole('button', { name: 'Converter para 3D' }).click();
  await expect(item).toHaveAttribute('data-status-bim', 'pronto', { timeout: 180_000 });
  await item.getByRole('link', { name: 'Vincular ambientes: Casa' }).click();
  await page.getByRole('button', { name: 'Salvar vínculos e usar este modelo' }).click();
  await expect(page.getByText(/unidades vinculadas e modelo ligado ao prédio\./)).toBeVisible();

  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  let vitrine = await abrirEmAlta(page);
  await expect(page.getByTestId('contagem-filtro')).toHaveText('7 de 7 unidades');

  // 21. a casa real, convertida e otimizada no 3D
  await assentar(page);
  await capturar(page, '21-bim-casa-fzk.png', 'Casa BIM real convertida no 3D', 'Projeto BIM (IFC) real da casa FZK, convertido e otimizado para rodar no navegador.');

  // 22. casa de bonecas com as paredes reais do IFC (não geradas)
  await page.getByLabel('Ver até o andar (corte)').selectOption({ label: '1º andar' });
  await page.getByRole('button', { name: 'Casa de bonecas' }).click();
  await expect(vitrine).toHaveAttribute('data-casa-bonecas', '1', { timeout: 15_000 });
  await assentar(page);
  await capturar(page, '22-bim-casa-bonecas.png', 'Casa de bonecas com paredes reais', 'No BIM, o corte usa as paredes de verdade do projeto (IFC), não paredes geradas automaticamente.');
});
