import { describe, it, expect } from 'vitest';
import { lerNumeroBr } from './numeros';

describe('números em formato brasileiro', () => {
  it.each([
    ['650000', 650000],
    ['650.000', 650000],
    ['650.000,00', 650000],
    ['1.234.567,89', 1234567.89],
    ['72,5', 72.5],
    ['72.5', 72.5],
    ['R$ 650.000,00', 650000],
    ['  3 ', 3],
    ['0', 0],
  ])('%s → %s', (texto, esperado) => expect(lerNumeroBr(texto)).toBe(esperado));

  it('vazio vira null', () => expect(lerNumeroBr('  ')).toBeNull());

  it.each(['abc', '1,234.56', '1,2,3', '12a', '--1'])('%s é inválido', (texto) => expect(lerNumeroBr(texto)).toBe('invalido'));
});
