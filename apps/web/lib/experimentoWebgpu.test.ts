import { describe, expect, it } from 'vitest';
import { pedidoRenderizadorExperimental } from './experimentoWebgpu';

describe('experimento ?renderizador=webgpu (Plano 12a, item 16)', () => {
  it('só true com o valor exato "webgpu"; não reconhece outros valores', () => {
    expect(pedidoRenderizadorExperimental('?renderizador=webgpu')).toBe(true);
    expect(pedidoRenderizadorExperimental('?outra=coisa&renderizador=webgpu')).toBe(true);
    expect(pedidoRenderizadorExperimental('')).toBe(false);
    expect(pedidoRenderizadorExperimental('?renderizador=webgl')).toBe(false);
    expect(pedidoRenderizadorExperimental('?renderizador=')).toBe(false);
  });
});
