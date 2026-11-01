import { describe, it, expect } from 'vitest';
import { Document, WebIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { glbParaBlender, ModeloSemRender } from './descomprimir';

/** Duas peças com nome de nó GUID (como o BIM grava) e extras do tipo IFC. */
async function modelo(): Promise<Uint8Array> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const cena = doc.createScene();
  for (const [nome, n] of [['2RSCzLOBz4FAK$_wE8VckM', 30], ['0e_hbkIQ5DMQlIJ$2V3j_m', 45]] as const) {
    const pos = new Float32Array(n * 3).map((_, i) => Math.sin(i) * 5);
    const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf));
    cena.addChild(doc.createNode(nome).setMesh(doc.createMesh().addPrimitive(prim)).setExtras({ ifc: 'IfcSpace' }));
  }
  return new WebIO().writeBinary(doc);
}

const json = (glb: Uint8Array) => {
  const v = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + v.getUint32(12, true))));
};

describe('GLB → GLB que o Blender abre', () => {
  it('Meshopt (como o BIM grava) volta a ser geometria normal, com os mesmos nós e vértices', async () => {
    const original = await modelo();
    await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
    const io = new WebIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.readBinary(original);
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    const comprimido = await io.writeBinary(doc);
    expect(json(comprimido).extensionsUsed).toContain('EXT_meshopt_compression');

    const plano = await glbParaBlender(comprimido);
    const j = json(plano);
    expect(j.extensionsUsed ?? []).not.toContain('EXT_meshopt_compression');
    const o = json(original);
    expect(j.nodes.map((n: { name?: string; extras?: object }) => [n.name, n.extras])).toEqual(o.nodes.map((n: { name?: string; extras?: object }) => [n.name, n.extras]));
    const vertices = (d: { accessors: Array<{ count: number }>; meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }> }) =>
      d.meshes.flatMap((m) => m.primitives.map((p) => d.accessors[p.attributes.POSITION]!.count));
    expect(vertices(j)).toEqual(vertices(o));
  });

  it('sem Meshopt devolve o mesmo arquivo; KTX2, mistura de compressões e lixo são recusados', async () => {
    const original = await modelo();
    expect(await glbParaBlender(original)).toBe(original);
    await expect(glbParaBlender(new TextEncoder().encode('não é glb, só texto qualquer'))).rejects.toThrow(ModeloSemRender);
    const com = (usadas: string[], exigidas: string[]) => {
      const js = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, extensionsUsed: usadas, extensionsRequired: exigidas }).padEnd(120, ' '));
      const glb = new Uint8Array(20 + js.length);
      const v = new DataView(glb.buffer);
      glb.set(new TextEncoder().encode('glTF'));
      v.setUint32(4, 2, true);
      v.setUint32(8, glb.length, true);
      v.setUint32(12, js.length, true);
      v.setUint32(16, 0x4e4f534a, true);
      glb.set(js, 20);
      return glb;
    };
    await expect(glbParaBlender(com(['KHR_texture_basisu'], ['KHR_texture_basisu']))).rejects.toThrow(/KHR_texture_basisu/);
    await expect(glbParaBlender(com(['EXT_meshopt_compression', 'KHR_draco_mesh_compression'], []))).rejects.toThrow(/Draco e Meshopt/);
  });
});
