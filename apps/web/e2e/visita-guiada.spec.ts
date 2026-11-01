import { test, expect, devices } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

const PLANILHA = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status', 'Torre G;1;101;Tipo 2Q;70;2;610.000,00;disponivel', 'Torre G;1;102;Tipo 3Q;98;3;820.000,00;disponivel', 'Torre G;5;501;Tipo 2Q;70;2;690.000,00;disponivel'].join('\n');
const posicao = async (el: import('@playwright/test').Locator) => ((await el.getAttribute('data-posicao')) ?? '').split(',').map(Number);

test('visita guiada ao vivo: a consultora conduz e a câmera do cliente segue; o cliente pode explorar sozinho', async ({ page, request, browser }) => {
  test.setTimeout(300_000);
  await entrarComoAdminComMfa(page, request, 'guiada');
  await page.getByLabel('Nome do projeto').fill('Residencial Guiado');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Guiado/ }).click();
  await page.getByLabel('Nome do prédio').fill('Torre G');
  await page.getByLabel('Andares').fill('5');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.getByLabel('Para quem (opcional)').fill('Família Lima');
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const link = (await page.getByTestId('link-cliente').textContent())!.trim();

  // consultora abre a Vitrine do painel
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });

  // cliente abre o link no celular (densidade 1: no teste os dois 3D dividem a mesma CPU, desenhados por software)
  const celular = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 1 });
  const cliente = await celular.newPage();
  await cliente.goto(link);
  const vitrineCliente = cliente.getByTestId('vitrine-3d');
  await expect(vitrineCliente).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await expect(vitrineCliente).toHaveAttribute('data-ao-vivo', 'conectado', { timeout: 90_000 });

  // consultora conduz
  await page.getByLabel('Link do cliente').selectOption({ label: 'Família Lima' });
  await page.getByRole('button', { name: 'Conduzir ao vivo' }).click();
  await expect(vitrine).toHaveAttribute('data-conducao', 'conduzindo');
  await page.getByTestId('lista-vitrine').getByRole('button', { name: /^501/ }).click(); // voa até a 501

  // o cliente vê a mesma câmera e a mesma unidade aberta
  await expect(vitrineCliente).toHaveAttribute('data-conducao', 'seguindo', { timeout: 15_000 });
  await expect(cliente.getByRole('heading', { name: 'Unidade 501' })).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () => {
        const [a, b] = [await posicao(vitrine), await posicao(vitrineCliente)];
        return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
      },
      { timeout: 20_000 },
    )
    .toBeLessThan(1);

  // cliente solta: explora sozinho; depois volta a seguir
  await cliente.getByRole('button', { name: 'Explorar sozinho' }).tap();
  await expect(vitrineCliente).toHaveAttribute('data-conducao', 'solto');
  await cliente.getByRole('button', { name: 'Seguir a consultora' }).tap();
  await expect(vitrineCliente).toHaveAttribute('data-conducao', 'seguindo');

  // consultora encerra: o cliente volta a ter o controle
  await page.getByRole('button', { name: 'Encerrar visita guiada' }).click();
  await expect(vitrineCliente).toHaveAttribute('data-conducao', '', { timeout: 15_000 });
  await celular.close();
});
