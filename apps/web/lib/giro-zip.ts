import { strFromU8, unzipSync } from 'fflate';
import type { Giro } from '@imersa/viewer';

/** Giro 360° fotorrealista (renderizado no Blender): o ZIP traz cor_###.jpg, mascara_###.png e giro.json. */
export class ErroGiro extends Error {}

/**
 * ZIP do giro → o mesmo formato do giro feito no navegador (o `Giro360` toca os dois). `unidades[i]` é a unidade
 * da cor-ID i, gravada no servidor quando o giro ficou pronto.
 */
export function giroDoZip(zip: Uint8Array, unidades: readonly string[]): Giro {
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(zip);
  } catch {
    throw new ErroGiro('O arquivo do giro está corrompido.');
  }
  const info = arquivos['giro.json'];
  if (!info) throw new ErroGiro('O arquivo do giro está incompleto.');
  const { quadros, largura, altura } = JSON.parse(strFromU8(info)) as { quadros: number; largura: number; altura: number };
  const lista: Giro['quadros'] = [];
  for (let q = 0; q < quadros; q++) {
    const n = String(q).padStart(3, '0');
    const cor = arquivos[`cor_${n}.jpg`];
    const mascara = arquivos[`mascara_${n}.png`];
    if (!cor || !mascara) throw new ErroGiro('O arquivo do giro está incompleto.');
    lista.push({ cor: new Blob([cor.slice()], { type: 'image/jpeg' }), mascara: new Blob([mascara.slice()], { type: 'image/png' }) });
  }
  return { quadros: lista, unidades: [...unidades], largura, altura };
}

/**
 * Ponto tocado na área → fração (0–1) da imagem. `imagem` null: a imagem ocupa a área toda (giro leve). Com o tamanho
 * da imagem (fotorrealista, object-contain): desconta as faixas; tocar nelas devolve null.
 */
export function pontoNaImagem(x: number, y: number, area: { largura: number; altura: number }, imagem: { largura: number; altura: number } | null) {
  if (!imagem) return { fx: x / area.largura, fy: y / area.altura };
  const escala = Math.min(area.largura / imagem.largura, area.altura / imagem.altura);
  const ox = (area.largura - imagem.largura * escala) / 2;
  const oy = (area.altura - imagem.altura * escala) / 2;
  const fx = (x - ox) / (imagem.largura * escala);
  const fy = (y - oy) / (imagem.altura * escala);
  return fx < 0 || fx > 1 || fy < 0 || fy > 1 ? null : { fx, fy };
}
