import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { arquivoPrincipal, converterParaGlb, ErroConversao, nomeDoGlb, type Assimp } from './converter-modelo';

let ajs: Assimp;
beforeAll(async () => {
  // o mesmo assimpjs do navegador, rodando no Node
  ajs = await (createRequire(import.meta.url)('assimpjs') as () => Promise<Assimp>)();
});

const texto = (s: string) => new TextEncoder().encode(s);
// cubo de 1 m com material vermelho (OBJ + MTL)
const OBJ = `mtllib cubo.mtl
o Cubo
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
usemtl Vermelho
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8
`;
const MTL = 'newmtl Vermelho\nKd 0.8 0.1 0.1\n';
const STL = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid t
`;

function jsonDoGlb(glb: Uint8Array) {
  const v = new DataView(glb.buffer, glb.byteOffset);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + v.getUint32(12, true))));
}

describe('outros formatos 3D → GLB (assimpjs)', () => {
  it('OBJ com MTL vira GLB com a malha e o material', () => {
    const glb = converterParaGlb(ajs, [
      { nome: 'cubo.mtl', dados: texto(MTL) },
      { nome: 'cubo.obj', dados: texto(OBJ) },
    ]);
    const j = jsonDoGlb(glb);
    expect(j.meshes.length).toBeGreaterThan(0);
    expect(JSON.stringify(j.materials)).toContain('Vermelho');
  });

  it('STL também; nome do GLB e arquivo principal entre os de apoio', () => {
    expect(jsonDoGlb(converterParaGlb(ajs, [{ nome: 'peca.stl', dados: texto(STL) }])).meshes.length).toBe(1);
    expect(arquivoPrincipal(['textura.png', 'sala.FBX', 'sala.mtl'])).toBe('sala.FBX');
    expect(nomeDoGlb('Sala Final.fbx')).toBe('Sala Final.glb');
  });

  it('sem arquivo 3D ou arquivo ruim: erro claro', () => {
    expect(() => converterParaGlb(ajs, [{ nome: 'foto.png', dados: texto('x') }])).toThrow(ErroConversao);
    expect(() => converterParaGlb(ajs, [{ nome: 'ruim.fbx', dados: texto('isto não é fbx') }])).toThrow(/Não foi possível converter ruim\.fbx/);
  });
});
