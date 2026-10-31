import { test, expect } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

/** Meta do PLANO-MESTRE §4.6 ("4G"): 9 Mbps, 100 ms de latência. */
const QUATRO_G = { offline: false, latency: 100, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 };
/** Referência de pior caso: "Slow 4G" do Lighthouse, 1,6 Mbps, 150 ms. */
const SLOW_4G = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const SEM_LIMITE = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
const META_PRIMEIRA_IMAGEM_MS = 4000;
const PRODUCAO = process.env.E2E_PRODUCAO === '1';

const linhas = ['predio;andar;codigo;tipologia;area_m2;quartos;preco;status'];
for (let a = 1; a <= 12; a++) for (let f = 1; f <= 4; f++) linhas.push(`Torre A;${a};${a}0${f};Tipo ${f % 2 ? 2 : 3}Q;${f % 2 ? 70 : 98};${f % 2 ? 2 : 3};${600 + a * 10 + f}.000,00;disponivel`);

test('primeira imagem da Vitrine em 4G (mediana de 3, cache vazio)', async ({ page, request }) => {
  test.setTimeout(400_000);
  await entrarComoAdminComMfa(page, request, 'desemp');
  await page.getByLabel('Nome do projeto').fill('Residencial Paulista');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Residencial Paulista/ }).click();
  await page.getByLabel('Latitude').fill('-23.56175');
  await page.getByLabel('Longitude').fill('-46.6545');
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await expect(page.getByText('Dados salvos.')).toBeVisible();
  await page.getByLabel('Nome do prédio').fill('Torre A');
  await page.getByLabel('Andares').fill('12');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(linhas.join('\n'));
  await page.getByRole('button', { name: 'Prévia' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Importação aplicada.')).toBeVisible();
  await page.getByRole('link', { name: /ver espelho de vendas/ }).click();
  await page.waitForURL(/\/painel\/predios\/[^/]+$/);
  const url = new URL(page.url());
  url.pathname += '/vitrine';
  // aquece o cache do entorno no servidor (a 1ª consulta ao OSM é por projeto, não por visita)
  await page.goto(url.toString());
  await expect(page.getByTestId('vitrine-3d')).toHaveAttribute('data-entorno', /^\d+$/, { timeout: 60_000 });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  /** 3 carregamentos com cache vazio, em ordem crescente (uma medida só oscila demais). */
  async function medir(perfil: typeof SLOW_4G): Promise<number[]> {
    await cdp.send('Network.emulateNetworkConditions', perfil);
    const tempos: number[] = [];
    for (let i = 0; i < 3; i++) {
      const inicio = Date.now();
      await page.goto(url.toString());
      await expect(page.getByTestId('vitrine-3d')).toHaveAttribute('data-estado', 'pronto', { timeout: 120_000 });
      tempos.push(Date.now() - inicio);
    }
    return tempos.sort((a, b) => a - b);
  }
  const semLimite = await medir(SEM_LIMITE);
  const quatroG = await medir(QUATRO_G);
  const slow4g = await medir(SLOW_4G);
  const js = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((r) => /\.js(\?|$)/.test(r.name))
      .reduce((s, r) => s + (r as PerformanceResourceTiming).encodedBodySize, 0),
  );
  const resultado = {
    modo: PRODUCAO ? 'produção' : 'desenvolvimento',
    medianaMs: { semLimiteDeRede: semLimite[1], quatroG: quatroG[1], slow4g: slow4g[1] },
    temposMs: { semLimiteDeRede: semLimite, quatroG, slow4g },
    jsInicialKb: Math.round(js / 1024),
  };
  console.log(`[desempenho] ${JSON.stringify(resultado)}`);
  test.info().annotations.push({ type: 'desempenho', description: JSON.stringify(resultado) });
  // a meta só vale para o build de produção (o modo dev não é minificado e compila sob demanda)
  if (PRODUCAO) expect(quatroG[1]).toBeLessThan(META_PRIMEIRA_IMAGEM_MS);
});
