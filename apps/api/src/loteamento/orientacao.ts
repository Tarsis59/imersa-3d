/**
 * Orientação do lote (Plano 12d, item 6): para onde a frente está virada, calculada do próprio polígono.
 *
 * Heurística do lado da frente: o lado do contorno voltado para a rua mais próxima (o lado cujo meio fica mais perto
 * de algum trecho das vias informadas); sem vias por perto (ainda sem o terreno do item 8, ou loteamento sem rua
 * desenhada), cai para o maior lado do polígono — nos loteamentos em grade a frente costuma ser o lado mais longo
 * voltado para a via, e é a única pista que o desenho por si só oferece.
 */

type P = readonly [number, number];

export interface Orientacao {
  /** Bússola, 0° a 360°: 0 = Norte, 90 = Leste (normal do lado da frente, para fora do lote). */
  anguloGraus: number;
  rotulo: string;
  /** "sol da manhã", "sol da tarde"... (hemisfério sul, como o resto do produto). */
  dica: string;
}

const ROSA_SUL: ReadonlyArray<{ nome: string; dica: string }> = [
  { nome: 'Norte', dica: 'fachada norte: sol o dia todo (a mais procurada no hemisfério sul)' },
  { nome: 'Nordeste', dica: 'sol da manhã' },
  { nome: 'Leste', dica: 'sol da manhã' },
  { nome: 'Sudeste', dica: 'sol da manhã ameno' },
  { nome: 'Sul', dica: 'fachada sul: pouco sol direto' },
  { nome: 'Sudoeste', dica: 'sol da tarde' },
  { nome: 'Oeste', dica: 'sol da tarde' },
  { nome: 'Noroeste', dica: 'sol da tarde, o mais forte' },
];
// hemisfério norte: a lógica do sol se inverte (a fachada sul é a mais procurada)
const ROSA_NORTE: ReadonlyArray<{ nome: string; dica: string }> = [
  { nome: 'Norte', dica: 'fachada norte: pouco sol direto' },
  { nome: 'Nordeste', dica: 'sol da manhã' },
  { nome: 'Leste', dica: 'sol da manhã' },
  { nome: 'Sudeste', dica: 'sol da manhã ameno' },
  { nome: 'Sul', dica: 'fachada sul: sol o dia todo (a mais procurada no hemisfério norte)' },
  { nome: 'Sudoeste', dica: 'sol da tarde' },
  { nome: 'Oeste', dica: 'sol da tarde' },
  { nome: 'Noroeste', dica: 'sol da tarde, o mais forte' },
];

const EM_METROS = (p: P, ref: P): [number, number] => [(p[0] - ref[0]) * 111_320 * Math.cos((ref[1] * Math.PI) / 180), (p[1] - ref[1]) * 110_540];

function distanciaAoSegmento(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/**
 * `contornoLonLat`: anel do lote (sem repetir o primeiro ponto no fim), em [lon, lat]. `viasLonLat`: polilinhas das
 * ruas perto do loteamento (também em [lon, lat]; pode vir vazio). `sul`: hemisfério do empreendimento (Brasil quase
 * todo é sul; `estudoSolar` usa a mesma convenção).
 */
export function orientacaoDoLote(contornoLonLat: readonly P[], viasLonLat: ReadonlyArray<ReadonlyArray<P>> = [], sul = true): Orientacao | null {
  if (contornoLonLat.length < 3) return null;
  const ref = contornoLonLat[0]!;
  const c = contornoLonLat.map((p) => EM_METROS(p, ref));
  const vias = viasLonLat.map((v) => v.map((p) => EM_METROS(p, ref))).filter((v) => v.length > 1);
  const centro: [number, number] = [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length];

  let melhor: { nx: number; ny: number; comprimento: number; distanciaVia: number } | null = null;
  for (let i = 0; i < c.length; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % c.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const comprimento = Math.hypot(dx, dy);
    if (comprimento < 1e-6) continue;
    // normal ao lado, virada para fora do lote (longe do centro do polígono)
    let nx = dy / comprimento;
    let ny = -dx / comprimento;
    const meioX = (a[0] + b[0]) / 2;
    const meioY = (a[1] + b[1]) / 2;
    if ((meioX - centro[0]) * nx + (meioY - centro[1]) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    let distanciaVia = Infinity;
    for (const via of vias) for (let j = 1; j < via.length; j++) distanciaVia = Math.min(distanciaVia, distanciaAoSegmento([meioX, meioY], via[j - 1]!, via[j]!));
    if (!melhor || (vias.length ? distanciaVia < melhor.distanciaVia : comprimento > melhor.comprimento)) melhor = { nx, ny, comprimento, distanciaVia };
  }
  if (!melhor) return null;
  // bússola: 0° Norte, 90° Leste (x = leste, y = norte)
  const anguloGraus = Math.round((((Math.atan2(melhor.nx, melhor.ny) * 180) / Math.PI + 360) % 360) * 10) / 10;
  const rosa = sul ? ROSA_SUL : ROSA_NORTE;
  const r = rosa[Math.round(anguloGraus / 45) % 8]!;
  return { anguloGraus, rotulo: r.nome, dica: r.dica };
}
