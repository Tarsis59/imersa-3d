import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lonLatToLocal, type LonLat } from '../geo/project';
import { construirArvores, escolherEspecie, type ArvoresConstruidas, type DescricaoArvore } from '../ambiente/vegetacao';
import { fita, paraModelo, type Xz } from './cidade';

/**
 * Terreno e infraestrutura do loteamento (Plano 12d, item 8): ruas, meio-fio, calçadas e árvores da região, lidos
 * do mesmo DXF dos lotes (ver `apps/api/.../loteamento/terreno.ts`); relevo das curvas de nível quando houver, ou o
 * relevo AWS que o viewer já tem (ver `terrenoDoRelevo`, em `cidade.ts`). Reaproveita a fita/árvore da cidade
 * completa (mesmo desenho, menos malhas) — por isso não "parece tabuleiro" mesmo sem o entorno real carregado.
 */
export interface TerrenoLoteamentoLido {
  ruas: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  calcadas: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  meioFio: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  curvas: ReadonlyArray<{ pontos: ReadonlyArray<readonly [number, number]>; elevacaoM: number }>;
}

export interface TerrenoLoteamento {
  objeto: THREE.Group;
  /** Altura do chão (m) em (x, z) do modelo: das curvas de nível quando houver; senão, a que foi passada (AWS). */
  altura(x: number, z: number): number;
  /** "Daqui a 10 anos" (item 10): 0 = muda recém-plantada (~1,5 m), 10 = altura adulta da espécie. */
  definirIdadeArvores(anos: number): void;
  destruir(): void;
}

const LARGURA_RUA_M = 7;
const LARGURA_CALCADA_M = 1.5;
const LARGURA_MEIO_FIO_M = 0.3;
/** Árvores a cada ~8 m nas calçadas (item 8), do lado de fora dela (não em cima do passeio). */
const ESPACO_ARVORES_M = 8;
/** Mudas saem do viveiro nessa altura, em qualquer espécie (item 10); acima disso, interpola até a altura adulta. */
export const ALTURA_MUDA_M = 1.5;

const ruido = (x: number, z: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Converte cada polilinha (lon/lat) para os eixos do modelo (girado), já no formato da `fita`/árvores. */
function paraLocais(linhas: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, centro: LonLat, rotacaoGraus: number): Xz[][] {
  return linhas.map((l) => l.map(([lon, lat]) => paraModelo(lonLatToLocal({ lon, lat }, centro), rotacaoGraus)));
}

/**
 * Relevo simples por interpolação das curvas de nível (Plano 12d, item 8): cada vértice de cada curva é uma amostra
 * de altura (a cota da curva); o ponto pedido pega a média das amostras pesada pelo inverso do quadrado da
 * distância (IDW) — não é um terrapleno de verdade, mas dá o caimento geral do terreno sem precisar de triangulação.
 * `null` sem nenhuma curva (quem chama cai para o relevo AWS).
 */
export function alturaDasCurvas(curvas: ReadonlyArray<{ pontos: readonly Xz[]; elevacaoM: number }>): ((x: number, z: number) => number) | null {
  const amostras = curvas.flatMap((c) => c.pontos.map((p) => ({ x: p.x, z: p.z, e: c.elevacaoM })));
  if (!amostras.length) return null;
  // relativiza pela primeira amostra: o chão do loteamento fica perto de 0, como o resto do viewer espera
  const base = amostras[0]!.e;
  return (x, z) => {
    let pesoTotal = 0;
    let valorTotal = 0;
    for (const a of amostras) {
      const d2 = (x - a.x) ** 2 + (z - a.z) ** 2;
      if (d2 < 0.01) return a.e - base;
      const peso = 1 / d2;
      pesoTotal += peso;
      valorTotal += peso * (a.e - base);
    }
    return valorTotal / pesoTotal;
  };
}

/** Árvores a cada ~8 m ao longo das calçadas, do lado de fora (perto da rua), com a espécie pela posição. */
function arvoresDaCalcada(calcadas: readonly Xz[][], altura: (x: number, z: number) => number): DescricaoArvore[] {
  const saida: DescricaoArvore[] = [];
  const afasta = LARGURA_CALCADA_M / 2 + 0.5;
  for (const pts of calcadas) {
    let resto = ESPACO_ARVORES_M / 2;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d === 0) continue;
      const nx = -(b.z - a.z) / d;
      const nz = (b.x - a.x) / d;
      for (let t = resto; t < d; t += ESPACO_ARVORES_M) {
        const c = { x: a.x + ((b.x - a.x) * t) / d, z: a.z + ((b.z - a.z) * t) / d };
        const p = { x: c.x + nx * afasta, z: c.z + nz * afasta };
        const r = ruido(p.x, p.z);
        saida.push({ x: p.x, y: altura(p.x, p.z), z: p.z, altura: 5 + r * 4, raio: 1.6 + r * 1.2, tom: r, especie: escolherEspecie(p.x, p.z) });
      }
      resto = (((resto - d) % ESPACO_ARVORES_M) + ESPACO_ARVORES_M) % ESPACO_ARVORES_M;
    }
  }
  return saida;
}

/**
 * Monta o terreno e a infraestrutura no 3D. `alturaBase` é o relevo que o viewer já tinha (AWS ou plano); se o DXF
 * trouxe curvas de nível, elas tomam a frente. `preparar` prepara o material (CSM, sombra das nuvens…), como as
 * outras peças da cidade completa.
 */
export function criarTerreno(terreno: TerrenoLoteamentoLido, centro: LonLat, rotacaoGraus: number, alturaBase: (x: number, z: number) => number, preparar: (m: THREE.Material) => void): TerrenoLoteamento {
  const objeto = new THREE.Group();
  objeto.name = 'terreno-loteamento';
  const geos: THREE.BufferGeometry[] = [];
  const materiais: THREE.Material[] = [];

  const curvasLocais = terreno.curvas.map((c) => ({ pontos: c.pontos.map(([lon, lat]) => paraModelo(lonLatToLocal({ lon, lat }, centro), rotacaoGraus)), elevacaoM: c.elevacaoM }));
  const alturaCurvas = alturaDasCurvas(curvasLocais);
  const altura = alturaCurvas ?? alturaBase;

  const ruas = paraLocais(terreno.ruas, centro, rotacaoGraus);
  const calcadas = paraLocais(terreno.calcadas, centro, rotacaoGraus);
  const meioFio = paraLocais(terreno.meioFio, centro, rotacaoGraus);

  const material = (cor: number, rugosidade: number, acima: number) => {
    const m = new THREE.MeshStandardMaterial({ color: cor, roughness: rugosidade, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -acima * 10, polygonOffsetUnits: -acima * 10 });
    preparar(m);
    materiais.push(m);
    return m;
  };
  const camada = (pontosPorLinha: readonly Xz[][], largura: number, acima: number, cor: number, rugosidade: number, nome: string): void => {
    const partes = pontosPorLinha.map((pts) => fita({ pontos: pts, largura }, altura, acima)).filter((g): g is THREE.BufferGeometry => g !== null);
    if (!partes.length) return;
    const unida = mergeGeometries(partes, false);
    for (const g of partes) g.dispose();
    if (!unida) return;
    unida.computeVertexNormals();
    geos.push(unida);
    const malha = new THREE.Mesh(unida, material(cor, rugosidade, acima));
    malha.name = nome;
    malha.receiveShadow = true;
    objeto.add(malha);
  };
  camada(ruas, LARGURA_RUA_M, 0.05, 0x47484c, 0.92, 'ruas'); // asfalto
  camada(calcadas, LARGURA_CALCADA_M, 0.1, 0xcdc8bd, 0.9, 'calcadas'); // concreto, um pouco acima da rua
  camada(meioFio, LARGURA_MEIO_FIO_M, 0.22, 0x8f8a7e, 0.85, 'meio-fio'); // a cota mais alta: a guia entre rua e calçada

  // árvores da região nas calçadas (itens 8 e 10): guarda a descrição "adulta" para o controle "Daqui a 10 anos"
  const arvoresAdultas = arvoresDaCalcada(calcadas, altura);
  let construidas: ArvoresConstruidas | null = null;
  const reconstruirArvores = (fator: number): void => {
    if (construidas) {
      for (const m of construidas.malhas) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      construidas.destruir();
      construidas = null;
    }
    if (!arvoresAdultas.length) return;
    const escaladas = arvoresAdultas.map((a) => ({ ...a, altura: THREE.MathUtils.lerp(ALTURA_MUDA_M, a.altura, fator), raio: a.raio * Math.max(0.3, fator) }));
    construidas = construirArvores(escaladas, preparar);
    for (const m of construidas.malhas) objeto.add(m);
  };
  reconstruirArvores(1); // adultas por padrão (quem quiser "daqui a 10 anos" de verdade usa o controle, item 10)

  return {
    objeto,
    altura,
    definirIdadeArvores(anos) {
      reconstruirArvores(THREE.MathUtils.clamp(anos, 0, 10) / 10);
    },
    destruir() {
      for (const g of geos) g.dispose();
      for (const m of materiais) m.dispose();
      if (construidas) construidas.destruir();
    },
  };
}
