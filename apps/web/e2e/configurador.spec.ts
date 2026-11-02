import { fileURLToPath } from 'node:url';
import { test, expect, type Locator } from '@playwright/test';
import { entrarComoAdminComMfa } from './ajuda';

// Casa FZK (IFC4) convertida de verdade; depois catálogo, configurador, orçamento
const FZK = fileURLToPath(new URL('../../../exemplos/projeto-bim/AC20-FZK-Haus.ifc', import.meta.url));
const PLANILHA = ['predio;andar;codigo;status', ...[1, 2, 3, 4, 5, 6].map((n) => `Casa;1;${n};disponivel`), 'Casa;2;7;vendido'].join('\n');
const PORCELANATO = 'Porcelanato acetinado areia 60×60';

/** Escolhe a opção cujo texto começa com `comeco` (o texto da opção também traz o preço). */
async function escolher(campo: Locator, comeco: string) {
  const valor = await campo.locator('option').filter({ hasText: comeco }).first().getAttribute('value');
  expect(valor, comeco).toBeTruthy();
  await campo.selectOption(valor!);
}

test('configurador: catálogo → acabamentos trocados em < 200 ms → móvel → orçamento salvo e impresso', async ({ page, request }) => {
  test.setTimeout(420_000);
  await entrarComoAdminComMfa(page, request, 'config');

  // catálogo inicial + preços do fornecedor
  await page.getByRole('link', { name: 'Catálogo' }).click();
  await page.getByRole('button', { name: 'Adicionar catálogo inicial' }).click();
  await expect(page.getByText(/19 materiais e 16 móveis adicionados/)).toBeVisible();
  const preco = page.getByLabel(`Preço por m² de ${PORCELANATO}`);
  await preco.fill('89,90');
  await preco.press('Enter');
  await expect(page.getByTestId('lista-materiais').getByText('Salvo')).toBeVisible();
  const precoCadeira = page.getByLabel('Preço de Cadeira', { exact: true });
  await precoCadeira.fill('350');
  await precoCadeira.press('Enter');
  await expect(page.getByTestId('lista-moveis').getByText('Salvo')).toBeVisible();

  // empreendimento com o modelo BIM ligado ao prédio
  await page.goto('/painel');
  await page.getByLabel('Nome do projeto').fill('Casa FZK');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.getByRole('link', { name: /Casa FZK/ }).click();
  await page.getByLabel('Nome do prédio').fill('Casa');
  await page.getByLabel('Andares').fill('2');
  await page.getByRole('button', { name: 'Criar prédio' }).click();
  await expect(page.getByText('Prédio criado.')).toBeVisible();
  await page.getByLabel('Conteúdo da planilha').fill(PLANILHA);
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
  await expect(page.getByText('7 unidades vinculadas e modelo ligado ao prédio.')).toBeVisible();

  // configurador
  await page.goto(page.url().replace(/\/bim.*$/, ''));
  await page.getByRole('link', { name: 'Configurador' }).click();
  const tela = page.getByTestId('configurador-3d');
  await expect(tela).toHaveAttribute('data-estado', 'pronto', { timeout: 90_000 });
  // superfícies do IFC, com área medida no 3D
  const piso = page.getByLabel('Acabamento: Pisos e lajes');
  const paredes = page.getByLabel('Acabamento: Paredes');
  await expect(piso).toBeVisible();
  await expect(paredes).toBeVisible();
  await expect(page.getByLabel('Acabamento: Telhado')).toBeVisible();

  // troca de acabamento sem recarregar a cena. Duas medidas por troca: o trabalho da troca (mudar o material) e o
  // tempo até o quadro seguinte desenhado (inclui esperar e desenhar 1 a 2 quadros).
  const trabalho: number[] = [];
  const ateQuadro: number[] = [];
  for (const [campo, material] of [
    [piso, PORCELANATO],
    [paredes, 'Pintura acrílica verde sálvia'],
    [piso, 'Vinílico carvalho natural'],
    [paredes, 'Tijolinho aparente'],
    [piso, 'Mármore Carrara'],
    [paredes, 'Cimento queimado'],
    [piso, 'Laminado nogueira'],
    [paredes, 'Tijolinho aparente'],
    [piso, PORCELANATO],
  ] as const) {
    const feitas = trabalho.length;
    await escolher(campo, material);
    await expect(campo.locator('option:checked')).toHaveText(new RegExp(`^${material}`));
    await expect(tela).toHaveAttribute('data-trocas', String(feitas + 1));
    ateQuadro.push(Number(await tela.getAttribute('data-troca-ms')));
    trabalho.push(Number(await tela.getAttribute('data-troca-trabalho-ms')));
  }
  const mediana = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)]!;
  const fps = await tela.getAttribute('data-fps');
  console.log(`TROCA trabalho ${trabalho.join(', ')} ms · até a tela ${ateQuadro.join(', ')} ms (mediana ${mediana(ateQuadro)}) · ${fps} FPS`);
  test.info().annotations.push({ type: 'troca', description: `trabalho ${trabalho.join(', ')} · tela ${ateQuadro.join(', ')} · ${fps} FPS` });
  // a troca em si: só muda números e textura já pronta (vale em qualquer máquina)
  for (const t of trabalho) expect(t).toBeLessThan(20);
  // na tela: com placa de vídeo (E2E_GPU=1; medido: 10–30 ms a 49 FPS), toda troca em < 200 ms. Sem placa (CI,
  // SwiftShader), o tempo até a tela mede o desenho por software, não a troca: fica só registrado
  if (process.env.E2E_GPU === '1') for (const t of ateQuadro) expect(t).toBeLessThan(200);
  await expect(page.getByTestId('tempo-troca')).toBeVisible();

  // decoração com um toque: todas as superfícies de uma vez, com o catálogo da empresa
  // pedido por texto: escolhe no catálogo e troca as superfícies certas
  const porTexto = page.getByTestId('acabamento-por-texto');
  await porTexto.getByLabel('Peça por texto').fill('piso de madeira, parede branca');
  await porTexto.getByRole('button', { name: 'Trocar' }).click();
  await expect(page.getByTestId('retorno-acabamento')).toContainText('Troquei:');
  const estilos = page.getByTestId('estilos');
  await estilos.getByRole('button', { name: 'Moderno' }).click();
  await expect(estilos.getByRole('button', { name: 'Moderno' })).toHaveAttribute('aria-pressed', 'true');
  await expect(piso.locator('option:checked')).toHaveText(/^Porcelanato cimentício grafite/);
  await expect(paredes.locator('option:checked')).toHaveText(/^Pintura acrílica cinza urbano/);
  await expect(page.getByTestId('tempo-estilo')).toHaveAttribute('data-ms', /^\d+$/);
  const msModerno = Number(await page.getByTestId('tempo-estilo').getAttribute('data-ms'));
  await estilos.getByRole('button', { name: 'Clássico' }).click();
  await expect(piso.locator('option:checked')).toHaveText(/^Mármore Carrara/);
  await expect(page.getByLabel('Acabamento: Telhado').locator('option:checked')).toHaveText(/^Telha cerâmica natural/);
  await expect(page.getByTestId('tempo-estilo')).toHaveAttribute('data-ms', /^\d+$/);
  const msClassico = Number(await page.getByTestId('tempo-estilo').getAttribute('data-ms'));
  test.info().annotations.push({ type: 'estilo', description: `moderno ${msModerno} ms · clássico ${msClassico} ms` });
  // aceite do plano: troca de estilo em menos de 1 s (com placa de vídeo; no CI o tempo mede o desenho por software)
  if (process.env.E2E_GPU === '1') for (const t of [msModerno, msClassico]) expect(t).toBeLessThan(1000);
  // ajustar uma superfície à mão desmarca o estilo; volta à combinação do teste
  await escolher(piso, PORCELANATO);
  await expect(estilos.getByRole('button', { name: 'Clássico' })).toHaveAttribute('aria-pressed', 'false');
  await escolher(paredes, 'Tijolinho aparente');
  await expect(paredes.locator('option:checked')).toHaveText(/^Tijolinho aparente/);

  // móvel: escolhe, coloca no térreo, ajusta
  await escolher(page.getByLabel('Móvel do catálogo'), 'Cadeira');
  await page.getByRole('button', { name: 'Colocar no centro do térreo' }).click();
  await expect(tela).toHaveAttribute('data-moveis', '1');
  const lista = page.getByTestId('lista-moveis-colocados');
  await expect(lista.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Mover para a direita' }).click();
  await page.getByRole('button', { name: 'Girar 90°' }).click();
  await expect(lista).toContainText('90°');

  // prévia do orçamento: piso em porcelanato + cadeira
  const previa = page.getByTestId('previa-orcamento');
  await expect(previa).toContainText(PORCELANATO);
  await expect(previa).toContainText('Cadeira');
  const totalPrevia = await page.getByTestId('previa-orcamento-total').textContent();
  await tela.screenshot({ path: test.info().outputPath('configurador-3d.png') });

  // salvar: a API recalcula e devolve o mesmo total
  await page.getByLabel('Nome da combinação').fill('Opção A — clara');
  await page.getByLabel('Cliente (opcional)').fill('Família Souza');
  await page.getByLabel('Unidade (opcional)').selectOption({ label: '4' });
  await page.getByRole('button', { name: 'Salvar combinação' }).click();
  await expect(page.getByText(/Combinação salva\. Total oficial:/)).toContainText(totalPrevia!.trim());
  await expect(page.getByTestId('lista-configuracoes')).toContainText('Opção A — clara');

  // reabrir: acabamentos e móvel voltam como foram salvos
  await page.getByTestId('lista-configuracoes').getByRole('link', { name: 'Abrir' }).click();
  await expect(page).toHaveURL(/configuracao=/, { timeout: 30_000 }); // no CI o modo dev compila a rota na hora
  await expect(tela).toHaveAttribute('data-estado', 'pronto', { timeout: 90_000 });
  await expect(tela).toHaveAttribute('data-moveis', '1');
  await expect(piso).toHaveValue(/.+/);
  await expect(page.getByLabel('Acabamento: Paredes').locator('option:checked')).toHaveText('Tijolinho aparente');

  // orçamento para imprimir
  await page.getByRole('link', { name: 'Ver orçamento para imprimir' }).click();
  // 1ª visita à página (o servidor de desenvolvimento compila a rota na hora)
  await expect(page.getByRole('heading', { name: 'Orçamento de personalização' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('orcamento')).toContainText('Família Souza');
  await expect(page.getByTestId('orcamento')).toContainText('unidade 4');
  await expect(page.getByTestId('orcamento-total')).toHaveText(totalPrevia!.trim());
  await expect(page.getByTestId('orcamento')).toContainText(/sem preço no catálogo/); // pinturas/tijolinho do catálogo inicial vêm sem preço
  await page.screenshot({ path: test.info().outputPath('orcamento.png'), fullPage: true });
});
