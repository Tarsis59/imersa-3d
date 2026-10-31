// Uso: pnpm --filter @imersa/viewer otimizar-glb <entrada.glb> <saida.glb> [meshopt|draco]
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { otimizarGlb, type Compressao } from '../src/ferramentas/otimizarGlb.ts';

const [entrada, saida, compressao = 'meshopt'] = process.argv.slice(2);
if (!entrada || !saida || !['meshopt', 'draco'].includes(compressao)) {
  console.error('Uso: otimizar-glb <entrada.glb> <saida.glb> [meshopt|draco]');
  process.exit(1);
}
// pnpm --filter roda na pasta do pacote; INIT_CWD é de onde a pessoa chamou
const base = process.env.INIT_CWD ?? process.cwd();
const original = await readFile(resolve(base, entrada));
const otimizado = await otimizarGlb(new Uint8Array(original), compressao as Compressao);
await writeFile(resolve(base, saida), otimizado);
const kb = (n: number) => `${Math.round(n / 1024)} KB`;
console.log(`${entrada} (${compressao}): ${kb(original.byteLength)} → ${kb(otimizado.byteLength)} (${Math.round((1 - otimizado.byteLength / original.byteLength) * 100)}% menor)`);
