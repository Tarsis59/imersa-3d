import * as THREE from 'three';
import type { Caixa } from '../units/tipos';

/** Tamanho padrão da maquete na mesa (maior lado no chão), em metros. */
export const TAMANHO_MAQUETE_M = 0.5;

/** Escala que deixa o maior lado do prédio (no chão) com `tamanhoM` metros: a maquete cabe numa mesa. */
export function escalaDaMaquete(caixa: Caixa, tamanhoM = TAMANHO_MAQUETE_M): number {
  const lado = Math.max(caixa.maxX - caixa.minX, caixa.maxZ - caixa.minZ, caixa.maxY - caixa.minY);
  return lado > 0 ? tamanhoM / lado : 1;
}

export interface Toque {
  x: number;
  y: number;
}

/**
 * Dois dedos na tela: quanto a maquete cresce (pinça) e gira (os dedos rodando) entre o início e agora. A rotação é
 * em radianos, no sentido de quem olha a tela de cima (dedos girando no horário viram a maquete no horário).
 */
export function gestoDeDoisDedos(a0: Toque, b0: Toque, a1: Toque, b1: Toque): { escala: number; rotacao: number } {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const escala = d0 > 0 && d1 > 0 ? d1 / d0 : 1;
  let rotacao = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x);
  if (rotacao > Math.PI) rotacao -= 2 * Math.PI;
  if (rotacao < -Math.PI) rotacao += 2 * Math.PI;
  return { escala, rotacao };
}

/** Limite da escala da maquete (não some nem vira um prédio de verdade no meio da sala). */
export const limitarEscala = (escala: number, base: number): number => THREE.MathUtils.clamp(escala, base * 0.25, base * 6);

/**
 * Onde a pessoa começa no passeio em VR: no chão, na frente da fachada (lado +z, o da entrada), a uma distância
 * que mostra o prédio de corpo inteiro sem precisar andar, olhando para ele (−z, a frente do espaço do óculos).
 */
export function pontoDeEntrada(caixa: Caixa): { x: number; y: number; z: number } {
  const largura = Math.max(caixa.maxX - caixa.minX, 1);
  return { x: (caixa.minX + caixa.maxX) / 2, y: 0, z: caixa.maxZ + THREE.MathUtils.clamp(largura * 0.6, 8, 40) };
}

/**
 * Cópia do prédio em miniatura, centrada e apoiada em y = 0, para a mesa (AR) e o arquivo do iPhone. As malhas
 * instanciadas (fachada, árvores, postes) viram malhas comuns, porque o arquivo USDZ não tem instâncias. Os
 * materiais são os mesmos do 3D (a situação das unidades continua igual na maquete).
 */
export function montarMaquete(objetos: readonly THREE.Object3D[], tamanhoM = TAMANHO_MAQUETE_M): THREE.Group {
  const conteudo = new THREE.Group();
  for (const o of objetos) {
    o.updateMatrixWorld(true);
    conteudo.add(semInstancias(o));
  }
  const b = new THREE.Box3().setFromObject(conteudo);
  const caixa: Caixa = b.isEmpty() ? { minX: -1, maxX: 1, minY: 0, maxY: 1, minZ: -1, maxZ: 1 } : { minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y, minZ: b.min.z, maxZ: b.max.z };
  conteudo.position.set(-(caixa.minX + caixa.maxX) / 2, -caixa.minY, -(caixa.minZ + caixa.maxZ) / 2);
  const maquete = new THREE.Group();
  maquete.name = 'maquete';
  maquete.add(conteudo);
  maquete.scale.setScalar(escalaDaMaquete(caixa, tamanhoM));
  return maquete;
}

/** Cópia que só leva o que está visível, já na posição do mundo, com instâncias desfeitas (maquete e foto). */
export function semInstancias(origem: THREE.Object3D): THREE.Object3D {
  const grupo = new THREE.Group();
  origem.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o instanceof THREE.InstancedMesh) {
      const matriz = new THREE.Matrix4();
      const cor = new THREE.Color();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, matriz);
        let material = o.material as THREE.Material;
        // cor própria da instância (copa das árvores): material com a cor já aplicada
        if (o.instanceColor && material instanceof THREE.MeshStandardMaterial) {
          o.getColorAt(i, cor);
          material = material.clone();
          (material as THREE.MeshStandardMaterial).color.multiply(cor);
          material.userData.daMaquete = true; // só a maquete usa: liberado quando ela sai
        }
        const m = new THREE.Mesh(o.geometry, material);
        matriz.premultiply(o.matrixWorld).decompose(m.position, m.quaternion, m.scale);
        grupo.add(m);
      }
      return;
    }
    const m = new THREE.Mesh(o.geometry, o.material);
    o.matrixWorld.decompose(m.position, m.quaternion, m.scale);
    m.name = o.name;
    grupo.add(m);
  });
  return grupo;
}

/**
 * Arquivo USDZ da maquete para o AR do iPhone (Quick Look: abre na mesa com um toque, sem app). Fica apoiado num
 * plano horizontal. Gerado no próprio aparelho, a partir do que está na tela.
 */
export async function exportarUsdz(maquete: THREE.Object3D): Promise<Blob> {
  const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
  const cena = new THREE.Scene();
  cena.add(maquete);
  cena.updateMatrixWorld(true);
  const bytes = await new USDZExporter().parseAsync(cena, { quickLookCompatible: true, maxTextureSize: 512 });
  cena.remove(maquete);
  return new Blob([bytes as BlobPart], { type: 'model/vnd.usdz+zip' });
}
