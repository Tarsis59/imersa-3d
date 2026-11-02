import { test, expect, type Page } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

const PLANILHA = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre V;1;101;Tipo 2Q;70;2;610.000,00;disponivel', 'Torre V;1;102;Tipo 3Q;98;3;820.000,00;vendido', 'Torre V;2;201;Tipo 2Q;70;2;690.000,00;reservado'].join('\n');

/** Aparelho com WebXR (óculos ou Android) e/ou Quick Look (iPhone), simulado antes de a página carregar. */
async function simularAparelho(page: Page, o: { modos: string[]; quickLook: boolean }) {
  await page.addInitScript((o) => {
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: {
        isSessionSupported: async (m: string) => o.modos.includes(m),
        // sem óculos de verdade no teste: o aparelho recusa abrir (o caminho de erro da tela)
        requestSession: async () => Promise.reject(new DOMException('sem aparelho', 'NotSupportedError')),
      },
    });
    if (o.quickLook) {
      const original = DOMTokenList.prototype.supports;
      DOMTokenList.prototype.supports = function (t: string) {
        return t === 'ar' || original.call(this, t);
      };
    }
  }, o);
}

async function abrirVitrine(page: Page, request: import('@playwright/test').APIRequestContext, nome: string) {
  await entrarComoAdminComMfa(page, request, nome);
  await page.getByLabel('Nome do projeto').fill(`Residencial ${nome}`);
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: new RegExp(`Residencial ${nome}`) }).click();
  await page.getByLabel('Nome do prédio').fill('Torre V');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  await expect(page.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
}

test('VR e AR: os botões só aparecem onde funcionam; o óculos que recusa mostra o aviso', async ({ page, request }) => {
  test.setTimeout(180_000);
  await simularAparelho(page, { modos: ['immersive-vr', 'immersive-ar'], quickLook: false });
  await abrirVitrine(page, request, 'imersivo');
  const cartao = page.getByTestId('imersivo');
  await expect(cartao.getByRole('button', { name: 'Ver em VR' })).toBeEnabled();
  await expect(cartao.getByRole('button', { name: 'Ver a maquete na mesa (AR)' })).toBeEnabled();
  await expect(cartao.getByTestId('link-quick-look')).toHaveCount(0); // não é iPhone

  await cartao.getByRole('button', { name: 'Ver em VR' }).click();
  await expect(cartao.getByRole('alert')).toContainText('O óculos não abriu a visita');
  await expect(page.getByTestId('vitrine-3d')).toHaveAttribute('data-imersivo', '');
  await cartao.getByRole('button', { name: 'Ver a maquete na mesa (AR)' }).click();
  await expect(cartao.getByRole('alert')).toContainText('A câmera não abriu');
  await expect(page.getByTestId('camada-ar')).toBeHidden(); // a camada da câmera não fica por cima da página

  // computador comum (sem WebXR simulado): nada de botão de VR/AR
  await page.addInitScript(() => Object.defineProperty(navigator, 'xr', { configurable: true, value: undefined }));
  await page.reload();
  await expect(page.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await expect(page.getByTestId('imersivo')).toHaveCount(0);
});

test('AR do iPhone: a maquete sai em USDZ válido, pronta antes do toque', async ({ page, request }) => {
  test.setTimeout(180_000);
  await simularAparelho(page, { modos: [], quickLook: true });
  await abrirVitrine(page, request, 'quicklook');
  const link = page.getByTestId('link-quick-look');
  await expect(link).toHaveAttribute('href', /^blob:/, { timeout: 30_000 });
  await expect(link).toHaveAttribute('rel', 'ar');
  await expect(link.locator('img')).toHaveCount(1); // o Quick Look só abre em AR se o link tiver uma imagem
  const arquivo = await link.evaluate(async (a: HTMLAnchorElement) => {
    const b = await (await fetch(a.href)).blob();
    const bytes = new Uint8Array(await b.arrayBuffer());
    const texto = new TextDecoder('latin1').decode(bytes);
    return { tipo: b.type, tamanho: bytes.length, zip: bytes[0] === 0x50 && bytes[1] === 0x4b, modelo: texto.indexOf('model.usda'), texturas: (texto.match(/textures\/Texture_/g) ?? []).length, materiais: (texto.match(/def Material/g) ?? []).length };
  });
  expect(arquivo.tipo).toBe('model/vnd.usdz+zip');
  expect(arquivo.zip).toBe(true);
  expect(arquivo.modelo).toBeGreaterThan(-1); // o modelo é o 1º arquivo do pacote
  expect(arquivo.modelo).toBeLessThan(64);
  expect(arquivo.materiais).toBeGreaterThanOrEqual(3); // as 3 unidades com a cor da situação, a fachada, as árvores
  expect(arquivo.texturas).toBeGreaterThan(0); // o pano de vidro com caixilhos
  expect(arquivo.tamanho).toBeGreaterThan(10_000);
});
