import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { blocosDaPlanta, type EdicaoPlanta, type TipoBloco } from './planta3d';

const COR: Record<TipoBloco, number> = { IfcWall: 0xece9e2, IfcDoor: 0x8b5a2b, IfcWindow: 0x9cc3d9, IfcSlab: 0xcfc8bb };
const PREFIXO: Record<TipoBloco, string> = { IfcWall: 'parede', IfcDoor: 'porta', IfcWindow: 'janela', IfcSlab: 'piso' };

/** Cena three.js da planta: uma malha por peça, com o tipo IFC em `userData` (vira `extras` no glTF). */
export function montarPlanta3d(e: EdicaoPlanta): THREE.Group {
  const grupo = new THREE.Group();
  grupo.name = 'planta';
  const materiais = new Map<TipoBloco, THREE.MeshStandardMaterial>();
  const material = (t: TipoBloco) => {
    let m = materiais.get(t);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: COR[t], roughness: t === 'IfcWindow' ? 0.1 : 0.85, transparent: t === 'IfcWindow', opacity: t === 'IfcWindow' ? 0.45 : 1 });
      m.name = PREFIXO[t];
      materiais.set(t, m);
    }
    return m;
  };
  const contagem = new Map<TipoBloco, number>();
  for (const b of blocosDaPlanta(e)) {
    const n = (contagem.get(b.tipo) ?? 0) + 1;
    contagem.set(b.tipo, n);
    const malha = new THREE.Mesh(new THREE.BoxGeometry(...b.tamanho), material(b.tipo));
    malha.position.set(...b.centro);
    malha.rotation.y = b.giroY;
    malha.name = `${PREFIXO[b.tipo]}-${n}`;
    malha.userData = b.tipo === 'IfcSlab' ? { ifc: b.tipo, ifcTipo: 'FLOOR' } : { ifc: b.tipo };
    grupo.add(malha);
  }
  return grupo;
}

/** GLB (binário) da planta, pronto para enviar como modelo 3D do prédio. */
export async function exportarGlb(e: EdicaoPlanta): Promise<ArrayBuffer> {
  const grupo = montarPlanta3d(e);
  const r = await new GLTFExporter().parseAsync(grupo, { binary: true });
  grupo.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
  if (!(r instanceof ArrayBuffer)) throw new Error('o exportador não devolveu GLB');
  return r;
}
