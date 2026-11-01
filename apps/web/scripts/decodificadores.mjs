// Copia os decodificadores gratuitos do three.js (Draco e Basis/KTX2) e o conversor de formatos 3D (assimpjs, MIT)
// para public/, na versão instalada.
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// 'three' resolve para <pacote>/build/three.cjs (o package.json não é exportado)
const libs = join(dirname(dirname(require.resolve('three'))), 'examples', 'jsm', 'libs');
const destino = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'decodificadores');
for (const [origem, pasta] of [
  [join(libs, 'draco', 'gltf'), 'draco'],
  [join(libs, 'basis'), 'basis'],
]) {
  mkdirSync(join(destino, pasta), { recursive: true });
  cpSync(origem, join(destino, pasta), { recursive: true, filter: (f) => !f.endsWith('.md') });
}
// assimpjs: FBX, OBJ, DAE, 3DS, STL... → GLB no próprio navegador (só carregado quando alguém converte)
const assimp = dirname(require.resolve('assimpjs'));
mkdirSync(join(destino, 'assimp'), { recursive: true });
for (const f of ['assimpjs.js', 'assimpjs.wasm', 'license.assimp.txt', 'license.assimpjs.txt']) cpSync(join(assimp, f), join(destino, 'assimp', f));
console.log('decodificadores copiados para public/decodificadores');
