import { describe, expect, it } from 'vitest';
import { precoFalado, roteiroDoVideo } from './roteiro';

const BASE = { projeto: 'Residencial Paulista', predio: 'Torre A', cidade: 'São Paulo', disponiveis: 3, aPartirDe: 650_000, lazer: ['Piscina', 'Academia', 'Salão de festas', 'Playground'] };

describe('roteiro falado do vídeo', () => {
  it('com tempo: empreendimento, oferta, lazer e o convite', () => {
    expect(roteiroDoVideo(BASE, 20)).toBe('Conheça o Residencial Paulista, em São Paulo. Torre A: três unidades disponíveis, a partir de R$ 650 mil. Lazer com piscina, academia e salão de festas. Agende sua visita.');
  });

  it('vídeo de 10 s: o que não cabe sai (lazer primeiro), e cabe na fala', () => {
    const t = roteiroDoVideo(BASE, 10);
    expect(t).not.toContain('Lazer');
    expect(t).toContain('a partir de R$ 650 mil');
    expect(t.split(/\s+/).length).toBeLessThanOrEqual(23);
    expect(t.endsWith('Agende sua visita.')).toBe(true);
  });

  it('sem unidade disponível, sem cidade e sem lazer: só o essencial', () => {
    expect(roteiroDoVideo({ ...BASE, disponiveis: 0, cidade: null, lazer: [] }, 10)).toBe('Conheça o Residencial Paulista. Agende sua visita.');
    expect(roteiroDoVideo({ ...BASE, disponiveis: 1, aPartirDe: null, lazer: [] }, 10)).toContain('Torre A: uma unidade disponível.');
    expect(roteiroDoVideo({ ...BASE, disponiveis: 40 }, 10)).toContain('40 unidades disponíveis');
  });

  it('preço como se fala', () => {
    expect(precoFalado(650_000)).toBe('R$ 650 mil');
    expect(precoFalado(1_250_000)).toBe('R$ 1,25 milhão');
    expect(precoFalado(2_400_000)).toBe('R$ 2,4 milhões');
  });
});
