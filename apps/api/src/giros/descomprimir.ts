import { WebIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

/** Extensões que o importador glTF do Blender 4.2 não lê (as outras, inclusive Draco, ele lê sozinho). */
const SEM_LEITOR_NO_BLENDER = ['KHR_texture_basisu'];

export class ModeloSemRender extends Error {}

function extensoes(glb: Uint8Array): { usadas: string[]; exigidas: string[] } {
  const v = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (glb.byteLength < 20 || v.getUint32(0, true) !== 0x46546c67) throw new ModeloSemRender('O modelo do prédio não é um GLB.');
  const doc = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + v.getUint32(12, true)))) as { extensionsUsed?: string[]; extensionsRequired?: string[] };
  return { usadas: doc.extensionsUsed ?? [], exigidas: doc.extensionsRequired ?? [] };
}

/**
 * GLB do prédio → GLB que o Blender abre. O BIM grava com Meshopt (o Blender não lê): a geometria volta a ser
 * normal, com os mesmos nós, nomes e extras (o vínculo com as unidades). Sem Meshopt, devolve o próprio arquivo.
 */
export async function glbParaBlender(glb: Uint8Array): Promise<Uint8Array> {
  const { usadas, exigidas } = extensoes(glb);
  const faltando = exigidas.filter((e) => SEM_LEITOR_NO_BLENDER.includes(e));
  if (faltando.length) throw new ModeloSemRender(`O modelo usa ${faltando.join(', ')}, que o render fotorrealista não lê. Envie o modelo com texturas PNG ou JPEG.`);
  if (!usadas.includes('EXT_meshopt_compression')) return glb;
  if (usadas.includes('KHR_draco_mesh_compression')) throw new ModeloSemRender('O modelo mistura Draco e Meshopt. Envie com um só tipo de compressão.');
  await MeshoptDecoder.ready;
  const io = new WebIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(glb);
  // ao ler, a geometria já foi descomprimida: tirar a extensão faz gravar sem comprimir de novo
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
  return io.writeBinary(doc);
}
