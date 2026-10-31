import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import { otimizarGlb } from './otimizarGlb';

const CASA = new URL('../../../../apps/web/e2e/fixtures/casa-fzk.glb', import.meta.url);

async function nomesDasPecas(bytes: Uint8Array): Promise<string[]> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'draco3d.decoder': await draco3d.createDecoderModule() });
  const doc = await io.readBinary(bytes);
  return doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getMesh())
    .map((n) => n.getName())
    .sort();
}

/** Extensões declaradas no JSON do GLB (primeiro bloco, depois do cabeçalho de 12 bytes). */
function extensoes(bytes: Uint8Array): string[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const json = JSON.parse(Buffer.from(bytes.subarray(20, 20 + v.getUint32(12, true))).toString('utf8')) as { extensionsUsed?: string[] };
  return json.extensionsUsed ?? [];
}

describe('otimizarGlb (gltf-transform + meshopt)', () => {
  it('a casa BIM real fica menor e mantém as 107 peças com os mesmos nomes (o vínculo com as unidades)', async () => {
    const original = new Uint8Array(await readFile(CASA));
    const otimizado = await otimizarGlb(original);
    expect(Buffer.from(otimizado.subarray(0, 4)).toString('latin1')).toBe('glTF');
    expect(otimizado.byteLength).toBeLessThan(original.byteLength * 0.6);
    expect(extensoes(otimizado)).toContain('EXT_meshopt_compression');
    const antes = await nomesDasPecas(original);
    expect(antes).toHaveLength(107);
    expect(await nomesDasPecas(otimizado)).toEqual(antes);
  }, 60_000);

  it('Draco (formato comum de quem exporta do Blender/Revit): também menor e com os mesmos nomes', async () => {
    const original = new Uint8Array(await readFile(CASA));
    const otimizado = await otimizarGlb(original, 'draco');
    expect(extensoes(otimizado)).toContain('KHR_draco_mesh_compression');
    expect(extensoes(otimizado)).not.toContain('EXT_meshopt_compression');
    expect(otimizado.byteLength).toBeLessThan(original.byteLength * 0.6);
    expect(await nomesDasPecas(otimizado)).toEqual(await nomesDasPecas(original));
  }, 60_000);
});
