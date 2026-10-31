import type * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** Pastas públicas com os decodificadores (copiados de `three/examples/jsm/libs`, gratuitos). */
export interface Decodificadores {
  /** Ex.: '/decodificadores/draco/' */
  draco?: string;
  /** Ex.: '/decodificadores/basis/' (texturas KTX2) */
  basis?: string;
}

/** GLTFLoader que abre GLB comprimido: Meshopt (embutido), Draco e texturas KTX2 (se as pastas forem informadas). */
export function criarCarregadorGltf(renderer: THREE.WebGLRenderer, d: Decodificadores = {}): { carregador: GLTFLoader; liberar(): void } {
  const carregador = new GLTFLoader();
  carregador.setMeshoptDecoder(MeshoptDecoder);
  const draco = d.draco ? new DRACOLoader().setDecoderPath(d.draco) : null;
  if (draco) carregador.setDRACOLoader(draco);
  const ktx2 = d.basis ? new KTX2Loader().setTranscoderPath(d.basis).detectSupport(renderer) : null;
  if (ktx2) carregador.setKTX2Loader(ktx2);
  return {
    carregador,
    liberar() {
      draco?.dispose();
      ktx2?.dispose();
    },
  };
}
