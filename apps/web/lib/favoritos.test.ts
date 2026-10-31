import { describe, it, expect } from 'vitest';
import { lerFavoritos, salvarFavoritos, alternarFavorito } from './favoritos';

function memoria() {
  const dados = new Map<string, string>();
  return { getItem: (k: string) => dados.get(k) ?? null, setItem: (k: string, v: string) => void dados.set(k, v), dados };
}
const quebrado = {
  getItem: () => {
    throw new Error('bloqueado');
  },
  setItem: () => {
    throw new Error('cheio');
  },
};

describe('favoritos', () => {
  it('salva e lê por prédio (um prédio não vê os do outro)', () => {
    const m = memoria();
    salvarFavoritos('p1', new Set(['a', 'b']), m);
    expect([...lerFavoritos('p1', m)].sort()).toEqual(['a', 'b']);
    expect(lerFavoritos('p2', m).size).toBe(0);
  });

  it('alternar adiciona e remove sem mexer no original', () => {
    const s = new Set(['a']);
    expect([...alternarFavorito(s, 'b')].sort()).toEqual(['a', 'b']);
    expect([...alternarFavorito(s, 'a')]).toEqual([]);
    expect([...s]).toEqual(['a']);
  });

  it('armazenamento bloqueado, ausente ou com lixo não quebra a página', () => {
    expect(lerFavoritos('p1', quebrado).size).toBe(0);
    expect(() => salvarFavoritos('p1', new Set(['a']), quebrado)).not.toThrow();
    expect(lerFavoritos('p1', null).size).toBe(0);
    const m = memoria();
    m.dados.set('imersa:favoritos:p1', '{"x":1}');
    expect(lerFavoritos('p1', m).size).toBe(0);
    m.dados.set('imersa:favoritos:p1', '["a", 3, null, "b"]');
    expect([...lerFavoritos('p1', m)].sort()).toEqual(['a', 'b']);
  });
});
