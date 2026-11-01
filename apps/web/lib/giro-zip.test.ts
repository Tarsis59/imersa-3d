import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { ErroGiro, giroDoZip, pontoNaImagem } from './giro-zip';

const zip = (quadros: number, faltar?: string) => {
  const arquivos: Record<string, Uint8Array> = { 'giro.json': strToU8(JSON.stringify({ quadros, largura: 1280, altura: 720, nos: ['a', 'b'], dispositivo: 'OPTIX' })) };
  for (let q = 0; q < quadros; q++) {
    const n = String(q).padStart(3, '0');
    arquivos[`cor_${n}.jpg`] = new Uint8Array([0xff, 0xd8, q]);
    arquivos[`mascara_${n}.png`] = new Uint8Array([0x89, 0x50, q]);
  }
  if (faltar) delete arquivos[faltar];
  return zipSync(arquivos, { level: 0 });
};

describe('giro fotorrealista: ZIP → Giro', () => {
  it('quadros na ordem, com o tipo certo, e as unidades do servidor', async () => {
    const g = giroDoZip(zip(3), ['u1', 'u2']);
    expect(g).toMatchObject({ largura: 1280, altura: 720, unidades: ['u1', 'u2'] });
    expect(g.quadros).toHaveLength(3);
    expect(g.quadros[2]!.cor.type).toBe('image/jpeg');
    expect(g.quadros[2]!.mascara.type).toBe('image/png');
    expect([...new Uint8Array(await g.quadros[2]!.cor.arrayBuffer())]).toEqual([0xff, 0xd8, 2]);
  });

  it('ZIP incompleto ou corrompido: erro claro', () => {
    expect(() => giroDoZip(zip(3, 'mascara_001.png'), [])).toThrow(ErroGiro);
    expect(() => giroDoZip(zip(2, 'giro.json'), [])).toThrow(/incompleto/);
    expect(() => giroDoZip(new Uint8Array([1, 2, 3]), [])).toThrow(/corrompido/);
  });
});

describe('toque no giro → ponto da máscara', () => {
  it('giro leve ocupa a área toda; fotorrealista em celular em pé tem faixas em cima e embaixo', () => {
    expect(pontoNaImagem(50, 25, { largura: 100, altura: 50 }, null)).toEqual({ fx: 0.5, fy: 0.5 });
    // 1280×720 numa tela 360×640: a imagem fica com 360×202,5, centrada (faixas de 218,75 px)
    const img = { largura: 1280, altura: 720 };
    expect(pontoNaImagem(180, 320, { largura: 360, altura: 640 }, img)).toEqual({ fx: 0.5, fy: 0.5 });
    expect(pontoNaImagem(0, 218.75, { largura: 360, altura: 640 }, img)).toEqual({ fx: 0, fy: 0 });
    expect(pontoNaImagem(180, 100, { largura: 360, altura: 640 }, img)).toBeNull();
  });
});
