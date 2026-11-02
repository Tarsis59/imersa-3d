import * as THREE from 'three';
import { movelPadrao, type MovelPadrao } from '../configurador/moveis';
import type { Caixa } from '../units/tipos';

/**
 * Apartamento decorado gerado na hora (Plano 11c, item 12): para o prédio que nasceu do texto (sem planta nem
 * modelo), entrar numa unidade mostra a sala, a cozinha e os quartos mobiliados no estilo escolhido, com paredes
 * internas que seguram a caminhada. A janela (face externa) é a frente: a sala fica nela; os quartos, no fundo.
 * Planta de verdade (BIM, planta 2D) sempre manda: isto só entra na caixa de vidro do prédio desenhado.
 */

export type EstiloDecorado = 'moderno' | 'classico' | 'jovem';

/** Paleta por estilo: piso, paredes e os tons que trocam o tecido e a madeira dos móveis padrão. */
export const PALETA: Record<EstiloDecorado, { piso: string; parede: string; tecido: string; madeira: string }> = {
  moderno: { piso: '#cfc7bb', parede: '#f2f1ee', tecido: '#7d8288', madeira: '#8a6a4f' },
  classico: { piso: '#9a6b45', parede: '#efe6d8', tecido: '#8a6d55', madeira: '#6d4a32' },
  jovem: { piso: '#e0d6c6', parede: '#f4f1ea', tecido: '#3f7f8c', madeira: '#c49a6c' },
};

export interface MovelNoLugar {
  chave: string;
  /** Centro da base, coordenadas da cena. */
  x: number;
  y: number;
  z: number;
  /** Giro em y (radianos): 0 = frente do móvel para +z. */
  yaw: number;
}

export interface PlanoDecorado {
  paredes: Caixa[];
  moveis: MovelNoLugar[];
  piso: Caixa;
  estilo: EstiloDecorado;
  /** Cômodos desenhados (sala, cozinha, quartos), para a tela e os testes. */
  comodos: string[];
  /** Onde a pessoa aparece ao entrar: atrás do sofá, olhando a sala e a janela. */
  entrada: { x: number; z: number };
}

const PAREDE_M = 0.1;
const PORTA_M = 0.9;

interface Local {
  chave: string;
  /** No referencial da unidade: u = lado a lado (direita da janela), v = da janela (0) para o fundo (profundidade). */
  u: number;
  v: number;
  /** Para onde a frente do móvel olha, no mesmo referencial (0 = para a janela, π = para o fundo). */
  giro: number;
}

/**
 * Planta simples por tipologia, num retângulo largura × profundidade (a janela no v = 0):
 *  - studio: cama no canto do fundo, sala e cozinha juntas;
 *  - 1 a 3 quartos: faixa do fundo dividida em quartos (o 1º é o de casal), sala/jantar/cozinha na frente.
 * Acima de 3 quartos, desenha 3 (o resto fica para a planta de verdade).
 */
export function layoutDaTipologia(quartos: number, largura: number, profundidade: number): { moveis: Local[]; paredes: Array<{ u0: number; v0: number; u1: number; v1: number }>; comodos: string[]; entrada: { u: number; v: number } } {
  const q = Math.max(0, Math.min(3, Math.round(quartos)));
  const meiaL = largura / 2;
  const moveis: Local[] = [];
  const paredes: Array<{ u0: number; v0: number; u1: number; v1: number }> = [];
  const comodos: string[] = [];
  const fundo = q === 0 ? 0 : Math.min(3.3, profundidade * 0.45);
  const frente = profundidade - fundo;

  // sala: TV junto da janela e o sofá olhando para ela (giro 0 = frente para a janela; π = para o fundo)
  comodos.push('sala');
  moveis.push({ chave: 'tapete', u: -meiaL * 0.25, v: frente * 0.45, giro: 0 });
  moveis.push({ chave: 'sofa-3', u: -meiaL * 0.25, v: frente * 0.45 + 1.2, giro: 0 });
  moveis.push({ chave: 'mesa-centro', u: -meiaL * 0.25, v: frente * 0.45, giro: 0 });
  moveis.push({ chave: 'rack-tv', u: -meiaL * 0.25, v: 0.45, giro: Math.PI });
  moveis.push({ chave: 'poltrona', u: -meiaL + 0.7, v: frente * 0.3, giro: -Math.PI / 2 });
  moveis.push({ chave: 'vaso-planta', u: -meiaL + 0.45, v: 0.45, giro: 0 });
  // cozinha linear e jantar do outro lado
  comodos.push('cozinha');
  moveis.push({ chave: 'cozinha-linear', u: meiaL - 0.33, v: frente * 0.55, giro: Math.PI / 2 });
  moveis.push({ chave: 'geladeira', u: meiaL - 0.4, v: Math.max(0.6, frente * 0.55 - 1.9), giro: Math.PI / 2 });
  moveis.push({ chave: 'mesa-4', u: meiaL * 0.4, v: frente * 0.32, giro: 0 });
  moveis.push({ chave: 'cadeira', u: meiaL * 0.4 - 0.55, v: frente * 0.32, giro: -Math.PI / 2 });
  moveis.push({ chave: 'cadeira', u: meiaL * 0.4 + 0.55, v: frente * 0.32, giro: Math.PI / 2 });

  if (q === 0) {
    comodos.push('cama');
    moveis.push({ chave: 'cama-casal', u: -meiaL + 1.0, v: profundidade - 1.15, giro: 0 });
    return { moveis, paredes, comodos, entrada: { u: meiaL * 0.1, v: frente * 0.45 + 2.0 } };
  }

  // parede entre a sala e os quartos, com uma porta por quarto; paredes entre os quartos
  const vParede = frente;
  const larguraQuarto = largura / q;
  const portas: Array<[number, number]> = [];
  for (let i = 0; i < q; i++) {
    const meio = -meiaL + larguraQuarto * (i + 0.5);
    portas.push([meio - PORTA_M / 2, meio + PORTA_M / 2]);
  }
  let u = -meiaL;
  for (const [a, b] of portas) {
    if (a > u) paredes.push({ u0: u, v0: vParede, u1: a, v1: vParede });
    u = b;
  }
  if (u < meiaL) paredes.push({ u0: u, v0: vParede, u1: meiaL, v1: vParede });
  for (let i = 1; i < q; i++) {
    const uu = -meiaL + larguraQuarto * i;
    paredes.push({ u0: uu, v0: vParede, u1: uu, v1: profundidade });
  }

  for (let i = 0; i < q; i++) {
    const meio = -meiaL + larguraQuarto * (i + 0.5);
    const encosto = profundidade - 0.15;
    if (i === 0) {
      comodos.push('quarto de casal');
      moveis.push({ chave: 'cama-casal', u: meio, v: encosto - 1.05, giro: 0 });
      moveis.push({ chave: 'mesa-cabeceira', u: meio - 1.1, v: encosto - 0.25, giro: 0 });
      moveis.push({ chave: 'mesa-cabeceira', u: meio + 1.1, v: encosto - 0.25, giro: 0 });
      if (larguraQuarto >= 3.2) moveis.push({ chave: 'guarda-roupa', u: -meiaL + larguraQuarto * i + 0.33, v: vParede + fundo * 0.5 + 0.2, giro: -Math.PI / 2 });
    } else {
      comodos.push('quarto');
      moveis.push({ chave: 'cama-solteiro', u: meio - larguraQuarto * 0.2, v: encosto - 1.0, giro: 0 });
      moveis.push({ chave: 'escrivaninha', u: meio + larguraQuarto * 0.22, v: encosto - 0.35, giro: 0 });
    }
  }
  return { moveis, paredes, comodos, entrada: { u: meiaL * 0.1, v: frente - 0.6 } };
}

/** Lado de fora da unidade (normal da janela) → giro do referencial da unidade na cena. */
export function planejarDecorado(caixa: Caixa, quartos: number | null, janela: { x: number; z: number } | null, estilo: EstiloDecorado = 'moderno'): PlanoDecorado {
  // a frente (v = 0) é a janela; sem face externa, a janela é o norte (−z)
  const n = janela ?? { x: 0, z: -1 };
  const eixoV = { x: -n.x, z: -n.z }; // da janela para dentro
  // sem espelhar: (u, v) gira como (x, z), então o giro dos móveis vale igual nos dois
  const eixoU = { x: eixoV.z, z: -eixoV.x };
  const lx = caixa.maxX - caixa.minX;
  const lz = caixa.maxZ - caixa.minZ;
  const largura = Math.abs(eixoU.x) > 0.5 ? lx : lz;
  const profundidade = Math.abs(eixoV.x) > 0.5 ? lx : lz;
  const cx = (caixa.minX + caixa.maxX) / 2;
  const cz = (caixa.minZ + caixa.maxZ) / 2;
  const y0 = caixa.minY + 0.02;
  // canto da janela: v = 0 fica a meio passo da parede externa
  const paraCena = (u: number, v: number) => ({ x: cx + eixoU.x * u + eixoV.x * (v - profundidade / 2), z: cz + eixoU.z * u + eixoV.z * (v - profundidade / 2) });
  const giroBase = Math.atan2(eixoV.x, eixoV.z); // v local → z da cena
  const l = layoutDaTipologia(quartos ?? 2, largura - 0.3, profundidade - 0.3);
  const moveis = l.moveis
    .filter((m) => movelPadrao(m.chave))
    .map((m) => {
      const p = paraCena(m.u, m.v + 0.15);
      return { chave: m.chave, x: p.x, y: y0, z: p.z, yaw: giroBase + m.giro + Math.PI };
    });
  const altura = caixa.maxY - caixa.minY - 0.05;
  const paredes = l.paredes.map((w) => {
    const a = paraCena(w.u0, w.v0 + 0.15);
    const b = paraCena(w.u1, w.v1 + 0.15);
    return {
      minX: Math.min(a.x, b.x) - PAREDE_M / 2,
      maxX: Math.max(a.x, b.x) + PAREDE_M / 2,
      minY: y0,
      maxY: y0 + altura,
      minZ: Math.min(a.z, b.z) - PAREDE_M / 2,
      maxZ: Math.max(a.z, b.z) + PAREDE_M / 2,
    };
  });
  const piso = { minX: caixa.minX, maxX: caixa.maxX, minY: caixa.minY, maxY: y0, minZ: caixa.minZ, maxZ: caixa.maxZ };
  return { paredes, moveis, piso, estilo, comodos: l.comodos, entrada: paraCena(l.entrada.u, l.entrada.v + 0.15) };
}

const TECIDO = '#8c8f94';
const MADEIRA = '#a77b52';

function corDoEstilo(cor: string, estilo: EstiloDecorado): string {
  if (cor.toLowerCase() === TECIDO) return PALETA[estilo].tecido;
  if (cor.toLowerCase() === MADEIRA) return PALETA[estilo].madeira;
  return cor;
}

/** Peças de um móvel padrão (caixas e cilindros) num grupo com a origem no centro da base. */
export function malhaDoMovel(m: MovelPadrao, estilo: EstiloDecorado, material: (cor: string, rugosidade: number) => THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.name = `movel-${m.chave}`;
  for (const p of m.pecas) {
    const geo = p.forma === 'caixa' ? new THREE.BoxGeometry(...p.tamanho) : new THREE.CylinderGeometry(p.tamanho[0] / 2, p.tamanho[0] / 2, p.tamanho[1], 16);
    const malha = new THREE.Mesh(geo, material(corDoEstilo(p.cor, estilo), p.rugosidade ?? 0.8));
    malha.position.set(...p.posicao);
    malha.castShadow = true;
    malha.receiveShadow = true;
    g.add(malha);
  }
  return g;
}

export interface Decorado {
  objeto: THREE.Group;
  /** Paredes internas: seguram a caminhada. */
  paredes: THREE.Object3D[];
  moveis: number;
  comodos: string[];
  destruir(): void;
}

export function montarDecorado(plano: PlanoDecorado, preparar: (m: THREE.Material) => void): Decorado {
  const objeto = new THREE.Group();
  objeto.name = 'decorado';
  const materiais = new Map<string, THREE.Material>();
  const material = (cor: string, rugosidade: number) => {
    const k = `${cor}|${rugosidade}`;
    let m = materiais.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: cor, roughness: rugosidade });
      preparar(m);
      materiais.set(k, m);
    }
    return m;
  };
  const cor = PALETA[plano.estilo];
  const caixaMalha = (c: Caixa, m: THREE.Material) => {
    const malha = new THREE.Mesh(new THREE.BoxGeometry(c.maxX - c.minX, c.maxY - c.minY, c.maxZ - c.minZ), m);
    malha.position.set((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2);
    malha.castShadow = true;
    malha.receiveShadow = true;
    return malha;
  };
  objeto.add(caixaMalha(plano.piso, material(cor.piso, 0.7)));
  const paredes = plano.paredes.map((w) => caixaMalha(w, material(cor.parede, 0.95)));
  for (const p of paredes) objeto.add(p);
  let n = 0;
  for (const m of plano.moveis) {
    const def = movelPadrao(m.chave);
    if (!def) continue;
    const g = malhaDoMovel(def, plano.estilo, material);
    g.position.set(m.x, m.y, m.z);
    g.rotation.y = m.yaw;
    objeto.add(g);
    n++;
  }
  return {
    objeto,
    paredes,
    moveis: n,
    comodos: plano.comodos,
    destruir() {
      objeto.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of materiais.values()) m.dispose();
    },
  };
}
