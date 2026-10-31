import { describe, it, expect } from 'vitest';
import { filtrar, filtroVazio } from './filtro';
import type { UnidadeViewer } from './tipos';

const u = (id: string, x: Partial<UnidadeViewer>): UnidadeViewer => ({
  id,
  codigo: id,
  andar: 1,
  status: 'disponivel',
  areaM2: 70,
  quartos: 2,
  preco: 500_000,
  meshNodeId: null,
  ...x,
});

const LISTA = [
  u('a', { quartos: 2, areaM2: 60, preco: 400_000 }),
  u('b', { quartos: 3, areaM2: 95, preco: 900_000, status: 'reservado' }),
  u('c', { quartos: 3, areaM2: 110, preco: 1_200_000, status: 'vendido' }),
  u('d', { quartos: null, areaM2: null, preco: null }),
];
const ids = (s: Set<string>) => [...s].sort();

describe('filtrar', () => {
  it('filtro vazio deixa passar todas', () => {
    expect(ids(filtrar(LISTA, filtroVazio()))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('quartos: opções combinam com OU', () => {
    expect(ids(filtrar(LISTA, { ...filtroVazio(), quartos: [3] }))).toEqual(['b', 'c']);
    expect(ids(filtrar(LISTA, { ...filtroVazio(), quartos: [2, 3] }))).toEqual(['a', 'b', 'c']);
  });

  it('área mínima e preço máximo (limites inclusivos)', () => {
    expect(ids(filtrar(LISTA, { ...filtroVazio(), areaMin: 95 }))).toEqual(['b', 'c']);
    expect(ids(filtrar(LISTA, { ...filtroVazio(), precoMax: 900_000 }))).toEqual(['a', 'b']);
  });

  it('critérios diferentes combinam com E', () => {
    expect(ids(filtrar(LISTA, { ...filtroVazio(), quartos: [3], precoMax: 1_000_000 }))).toEqual(['b']);
  });

  it('sem dado não passa num filtro desse dado (não dá para garantir)', () => {
    expect(filtrar(LISTA, { ...filtroVazio(), areaMin: 1 }).has('d')).toBe(false);
    expect(filtrar(LISTA, { ...filtroVazio(), precoMax: 10_000_000 }).has('d')).toBe(false);
    expect(filtrar(LISTA, { ...filtroVazio(), quartos: [2] }).has('d')).toBe(false);
  });

  it('status e só favoritos', () => {
    expect(ids(filtrar(LISTA, { ...filtroVazio(), status: ['disponivel'] }))).toEqual(['a', 'd']);
    expect(ids(filtrar(LISTA, { ...filtroVazio(), somenteFavoritos: true }, new Set(['c', 'x'])))).toEqual(['c']);
    expect(filtrar(LISTA, { ...filtroVazio(), somenteFavoritos: true }).size).toBe(0);
  });
});
