import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

const FZK = fileURLToPath(new URL('../../../exemplos/projeto-bim/AC20-FZK-Haus.ifc', import.meta.url));
const PLANILHA = ['predio;andar;codigo;status', ...[1, 2, 3, 4, 5, 6].map((n) => `Casa;1;${n};disponivel`), 'Casa;2;7;vendido'].join('\n');

test('giro 360° fotorrealista: IFC real → pedido na página do prédio → worker → Vitrine e link do cliente, tocar abre a unidade', async ({ page, request }) => {
  test.setTimeout(600_000);
  await entrarComoAdminComMfa(page, request, 'girofoto');
  await page.getByLabel('Nome do projeto').fill('Casa Foto');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Casa Foto/ }).click();
  await page.getByLabel('Nome do prédio').fill('Casa');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();

  // modelo real: IFC → GLB com Meshopt (como em produção) e os 7 ambientes ligados às unidades
  await page.locator('#tipo-arquivo').selectOption({ label: 'Projeto BIM (.ifc)' });
  await page.locator('#arquivo-envio').setInputFiles(FZK);
  await page.getByRole('button', { name: 'Enviar arquivo' }).click();
  await expect(page.getByText('AC20-FZK-Haus.ifc enviado e verificado.')).toBeVisible({ timeout: 60_000 });
  const item = page.getByTestId('lista-bim').getByRole('listitem').filter({ hasText: 'AC20-FZK-Haus.ifc' });
  await item.getByRole('button', { name: 'Converter para 3D' }).click();
  await expect(item).toHaveAttribute('data-status-bim', 'pronto', { timeout: 180_000 });
  await item.getByRole('link', { name: 'Vincular ambientes: Casa' }).click();
  await page.getByRole('button', { name: 'Salvar vínculos e usar este modelo' }).click();
  await expect(page.getByText('7 unidades vinculadas e modelo ligado ao prédio.')).toBeVisible();

  // página do prédio: pedir o giro; o worker renderiza (Blender) e a página mostra pronto
  const predio = (await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).getAttribute('href'))!.replace(/\/vitrine$/, '');
  await page.goto(predio);
  const cartao = page.getByTestId('giro-renderizado');
  await expect(cartao).toHaveAttribute('data-status', 'nenhum');
  await page.getByRole('button', { name: 'Gerar giro 360° fotorrealista' }).click();
  await expect(cartao).toHaveAttribute('data-status', /na_fila|processando|pronto/);
  await expect(page.getByRole('button', { name: 'Giro na fila…' }).or(page.getByRole('button', { name: 'Gerar o giro de novo' }))).toBeVisible();
  await expect
    .poll(
      async () => {
        await page.reload();
        return cartao.getAttribute('data-status');
      },
      { timeout: 420_000, intervals: [3_000] },
    )
    .toBe('pronto');
  await expect(cartao).toContainText('aparece na Vitrine e nos links para clientes');

  // Vitrine: abre o giro fotorrealista (não gera nada no navegador)
  await page.getByRole('link', { name: 'Abrir Vitrine 3D' }).click();
  const vitrine = page.getByTestId('vitrine-3d');
  await expect(vitrine).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Abrir giro 360° fotorrealista' }).click();
  const giro = page.getByTestId('giro');
  await expect(giro).toHaveAttribute('data-tipo', 'fotorrealista', { timeout: 30_000 });
  await expect(giro).toHaveAttribute('data-quadro', '0');
  const imagemCarregada = () => giro.locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0);
  await expect.poll(imagemCarregada).toBe(true);
  const total = Number(await giro.getByRole('slider').getAttribute('aria-valuemax')) + 1;
  expect(total).toBe(process.env.IMERSA_BLENDER ? 24 : 8);
  const area = giro.getByRole('slider');
  await area.focus();
  await page.keyboard.press('ArrowRight');
  await expect(giro).toHaveAttribute('data-quadro', '1');
  await page.keyboard.press('ArrowLeft');
  await expect(giro).toHaveAttribute('data-quadro', '0');

  // tocar na casa: a máscara do Blender diz qual unidade (ambiente) é
  const caixa = (await area.boundingBox())!;
  const unidade = page.getByTestId('unidade-selecionada');
  for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.45], [0.55, 0.55], [0.5, 0.4], [0.5, 0.6], [0.4, 0.5], [0.6, 0.5]] as const) {
    await page.mouse.click(caixa.x + caixa.width * fx, caixa.y + caixa.height * fy);
    if (await unidade.isVisible().catch(() => false)) break;
    await page.waitForTimeout(300);
  }
  await expect(unidade).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Unidade [1-7]$/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('giro-fotorrealista.png') });
  await page.getByRole('button', { name: '← Voltar ao 3D' }).click();
  await expect(giro).toHaveCount(0);

  // estúdio de marketing: vídeo 9:16 do prédio (Blender, com selo) → assistir e baixar
  await page.goto(predio);
  const estudio = page.getByTestId('estudio');
  // com narração (voz feminina, roteiro automático com os dados do prédio); no teste, a voz é simulada
  await estudio.getByLabel('Voz').selectOption({ label: 'Voz feminina (Dora)' });
  await expect(estudio.getByLabel('Roteiro (opcional)')).toBeVisible();
  await estudio.getByRole('button', { name: 'Gerar vídeo Reels e Stories (9:16)' }).click();
  // o pedido entra na lista (o worker do teste pega em 2 s: "na fila" pode já ter passado quando a tela atualiza)
  const itemVideo = estudio.getByTestId('lista-videos').getByRole('listitem').first();
  await expect(itemVideo).toHaveAttribute('data-status-video', /na_fila|processando|pronto/);
  await expect
    .poll(
      async () => {
        await page.reload();
        return itemVideo.getAttribute('data-status-video');
      },
      { timeout: 420_000, intervals: [3_000] },
    )
    .toBe('pronto');
  await expect(itemVideo.getByTestId('video-narrado')).toContainText('Voz feminina (Dora)');
  await itemVideo.getByRole('button', { name: 'Assistir' }).click();
  const video = itemVideo.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 1 && v.videoHeight > v.videoWidth), { timeout: 30_000 }).toBe(true);
  const baixado = page.waitForEvent('download');
  await itemVideo.getByRole('button', { name: 'Baixar MP4' }).click();
  expect((await baixado).suggestedFilename()).toBe('Casa-reels-stories.mp4');

  // link do cliente (sem login): o mesmo giro
  await page.goto(predio);
  await page.getByRole('button', { name: 'Gerar link' }).click();
  const link = (await page.getByTestId('link-cliente').textContent())!.trim();
  const cliente = await page.context().browser()!.newContext();
  const portal = await cliente.newPage();
  await portal.goto(link);
  await expect(portal.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto', { timeout: 60_000 });
  await portal.getByRole('button', { name: 'Abrir giro 360° fotorrealista' }).click();
  await expect(portal.getByTestId('giro')).toHaveAttribute('data-tipo', 'fotorrealista', { timeout: 30_000 });
  await expect.poll(() => portal.getByTestId('giro').locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await cliente.close();
});
