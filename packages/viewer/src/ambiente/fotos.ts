import * as THREE from 'three';
import { lonLatToLocal, type LonLat } from '../geo/project';
import type { Caixa } from '../units/tipos';
import { paraModelo } from '../city/cidade';

/**
 * Fotos reais no lugar certo (Plano 11c, item 14): cada foto do imóvel com GPS vira um quadro num poste, no ponto onde
 * foi tirada, virado para quem olha na mesma direção da câmera (rumo da bússola do EXIF). Sem rumo, o quadro fica de
 * costas para o prédio: quem olha a foto olha para o prédio, como quem a tirou. Tocar no quadro abre a foto.
 */

export interface FotoNoLugar {
  id: string;
  lat: number;
  lon: number;
  /** Graus a partir do norte, sentido horário; `null` = sem bússola. */
  rumo: number | null;
}

export interface QuadroPlanejado {
  id: string;
  x: number;
  z: number;
  /** Giro em y do quadro (a frente, com a foto, para +z antes de girar). */
  yaw: number;
}

/** Longe disso do prédio, a foto não é do imóvel (ou o GPS errou). */
const ALCANCE_M = 400;
/** Quadro dentro do lote vai para a calçada (não fica enterrado no prédio). */
const FOLGA_LOTE_M = 3;

/** Onde fica cada quadro, nos eixos do modelo. Fotos no mesmo lugar se afastam um pouco (sem quadro em cima de quadro). */
export function planejarQuadros(fotos: readonly FotoNoLugar[], centro: LonLat, rotacaoGraus: number, lote: Caixa | null): QuadroPlanejado[] {
  const saida: QuadroPlanejado[] = [];
  for (const f of fotos) {
    const l = lonLatToLocal({ lon: f.lon, lat: f.lat }, centro);
    let p = paraModelo(l, rotacaoGraus);
    if (Math.hypot(p.x, p.z) > ALCANCE_M) continue;
    if (lote && p.x > lote.minX - FOLGA_LOTE_M && p.x < lote.maxX + FOLGA_LOTE_M && p.z > lote.minZ - FOLGA_LOTE_M && p.z < lote.maxZ + FOLGA_LOTE_M) {
      // empurra para fora pelo lado mais perto
      const lados = [
        { d: p.x - (lote.minX - FOLGA_LOTE_M), q: { x: lote.minX - FOLGA_LOTE_M, z: p.z } },
        { d: lote.maxX + FOLGA_LOTE_M - p.x, q: { x: lote.maxX + FOLGA_LOTE_M, z: p.z } },
        { d: p.z - (lote.minZ - FOLGA_LOTE_M), q: { x: p.x, z: lote.minZ - FOLGA_LOTE_M } },
        { d: lote.maxZ + FOLGA_LOTE_M - p.z, q: { x: p.x, z: lote.maxZ + FOLGA_LOTE_M } },
      ];
      p = lados.sort((a, b) => a.d - b.d)[0]!.q;
    }
    for (let k = 0; saida.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1.8) && k < 12; k++) p = { x: p.x + 1.9, z: p.z };
    // direção em que a câmera olhava (chão local: x leste, z sul), passada para os eixos do modelo
    let olhar: { x: number; z: number };
    if (f.rumo !== null && Number.isFinite(f.rumo)) {
      const r = (f.rumo * Math.PI) / 180;
      olhar = paraModelo({ x: Math.sin(r), z: -Math.cos(r) }, rotacaoGraus);
    } else {
      const d = Math.hypot(p.x, p.z) || 1;
      olhar = { x: -p.x / d, z: -p.z / d };
    }
    // a foto (frente +z) fica virada para trás, para quem está atrás do quadro olhando na mesma direção
    saida.push({ id: f.id, x: p.x, z: p.z, yaw: Math.atan2(-olhar.x, -olhar.z) });
  }
  return saida;
}

export interface QuadrosDeFoto {
  objeto: THREE.Group;
  clicaveis(): THREE.Object3D[];
  idDe(o: THREE.Object3D | null): string | null;
  /** Põe a imagem no quadro (carregada só quando a tela pede, pelo link assinado). */
  definirImagem(id: string, url: string): Promise<boolean>;
  quantos: number;
  destruir(): void;
}

const LARGURA_M = 1.6;
const ALTURA_M = 1.1;
const BASE_M = 1.15;

export function criarQuadros(planos: readonly QuadroPlanejado[], altura: (x: number, z: number) => number, preparar: (m: THREE.Material) => void): QuadrosDeFoto {
  const objeto = new THREE.Group();
  objeto.name = 'fotos-no-lugar';
  const mPoste = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.6 });
  const mMoldura = new THREE.MeshStandardMaterial({ color: 0x1f2226, roughness: 0.4 });
  preparar(mPoste);
  preparar(mMoldura);
  const gPoste = new THREE.CylinderGeometry(0.04, 0.05, BASE_M, 8);
  gPoste.translate(0, BASE_M / 2, 0);
  const gMoldura = new THREE.BoxGeometry(LARGURA_M + 0.1, ALTURA_M + 0.1, 0.06);
  const gFoto = new THREE.PlaneGeometry(LARGURA_M, ALTURA_M);
  const fotos = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>();
  const donos = new Map<THREE.Object3D, string>();
  for (const q of planos) {
    const g = new THREE.Group();
    g.name = `foto-${q.id}`;
    g.position.set(q.x, altura(q.x, q.z), q.z);
    g.rotation.y = q.yaw;
    const poste = new THREE.Mesh(gPoste, mPoste);
    const moldura = new THREE.Mesh(gMoldura, mMoldura);
    moldura.position.y = BASE_M + ALTURA_M / 2;
    moldura.castShadow = true;
    // até a imagem chegar: cinza claro com o "foto" no meio (sem textura nenhuma baixada)
    const foto = new THREE.Mesh(gFoto, new THREE.MeshBasicMaterial({ color: 0xd9dde2, toneMapped: false }));
    foto.position.set(0, BASE_M + ALTURA_M / 2, 0.035);
    g.add(poste, moldura, foto);
    objeto.add(g);
    fotos.set(q.id, foto);
    for (const o of [moldura, foto]) donos.set(o, q.id);
  }
  const carregador = new THREE.TextureLoader();
  return {
    objeto,
    quantos: planos.length,
    clicaveis: () => [...donos.keys()],
    idDe: (o) => (o ? (donos.get(o) ?? null) : null),
    async definirImagem(id, url) {
      const foto = fotos.get(id);
      if (!foto) return false;
      try {
        const t = await carregador.loadAsync(url);
        t.colorSpace = THREE.SRGBColorSpace;
        const img = t.image as { width?: number; height?: number };
        // foto em pé ou deitada: o quadro segue a proporção (cabe em 1,6 × 1,1 m)
        const prop = img.width && img.height ? img.width / img.height : LARGURA_M / ALTURA_M;
        const s = prop >= LARGURA_M / ALTURA_M ? { x: 1, y: LARGURA_M / prop / ALTURA_M } : { x: (ALTURA_M * prop) / LARGURA_M, y: 1 };
        foto.scale.set(s.x, s.y, 1);
        foto.material.map?.dispose();
        foto.material.map = t;
        foto.material.color.set(0xffffff);
        foto.material.needsUpdate = true;
        return true;
      } catch {
        return false;
      }
    },
    destruir() {
      for (const f of fotos.values()) {
        f.material.map?.dispose();
        f.material.dispose();
      }
      gPoste.dispose();
      gMoldura.dispose();
      gFoto.dispose();
      mPoste.dispose();
      mMoldura.dispose();
    },
  };
}
