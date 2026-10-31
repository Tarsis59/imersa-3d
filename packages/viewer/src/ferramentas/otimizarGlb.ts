import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

export type Compressao = 'meshopt' | 'draco';

/**
 * Comprime um GLB (Meshopt ou Draco; ambos gratuitos), SEM juntar nem renomear peças: o nome de cada peça é o
 * vínculo com a unidade no banco. Só para Node (ferramenta de preparo do arquivo), não vai para o navegador.
 */
export async function otimizarGlb(bytes: Uint8Array, compressao: Compressao = 'meshopt'): Promise<Uint8Array> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });
  const doc = await io.readBinary(bytes);
  await doc.transform(dedup(), compressao === 'draco' ? draco({ method: 'edgebreaker' }) : meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  return io.writeBinary(doc);
}
