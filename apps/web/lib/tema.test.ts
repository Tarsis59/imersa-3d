import { describe, it, expect } from 'vitest';
import { contraste, textoSobre, estiloMarca } from './tema';

describe('tema da marca (Plano 12b, item 11)', () => {
  it('contraste entre preto e branco é o máximo (21:1)', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('cor clara: texto escuro (branco não teria contraste)', () => {
    expect(textoSobre('#fbbf24')).toBe('#0f172a'); // amarelo: claro, precisa de texto escuro
  });

  it('cor escura: texto branco (já tem contraste)', () => {
    expect(textoSobre('#1e3a8a')).toBe('#ffffff'); // azul escuro
  });

  it('sem marca: nenhuma variável (o tema padrão continua valendo)', () => {
    expect(estiloMarca(null)).toEqual({});
    expect(estiloMarca(undefined)).toEqual({});
  });

  it('com cor: define --acento e --acento-texto com contraste garantido', () => {
    const estilo = estiloMarca({ corPrimaria: '#fbbf24', fonte: 'sistema' });
    expect(estilo['--acento']).toBe('#fbbf24');
    expect(estilo['--acento-texto']).toBe('#0f172a');
  });

  it('sem cor (só fonte): não define --acento, mas define --font-sans', () => {
    const estilo = estiloMarca({ corPrimaria: null, fonte: 'poppins' });
    expect(estilo['--acento']).toBeUndefined();
    expect(estilo['--font-sans']).toContain('Poppins');
  });
});
