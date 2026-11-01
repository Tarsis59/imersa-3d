import { describe, it, expect } from 'vitest';
import { conferir, inicial, lerOcioso, lerSinal, OCIOSO_PADRAO_S, SINAL_PADRAO_S, tocar } from './estande';

describe('estande: apresentação e recomeço', () => {
  it('começa apresentando; o toque sai da apresentação sem recomeçar', () => {
    const e = tocar(inicial(0), 1000);
    expect(e).toEqual({ apresentando: false, ultimoToque: 1000, reinicio: 0 });
  });

  it('volta à apresentação só depois do tempo ocioso, e recomeça uma vez', () => {
    let e = tocar(inicial(0), 1000);
    e = conferir(e, 1000 + 89_999, 90);
    expect(e.apresentando).toBe(false);
    e = conferir(e, 1000 + 90_000, 90);
    expect(e).toMatchObject({ apresentando: true, reinicio: 1 });
    // continuar parado não recomeça de novo a cada segundo
    expect(conferir(e, 1000 + 500_000, 90)).toBe(e);
  });

  it('cada toque adia o ócio', () => {
    let e = tocar(inicial(0), 0);
    e = tocar(e, 80_000);
    expect(conferir(e, 150_000, 90).apresentando).toBe(false);
    expect(conferir(e, 170_000, 90).apresentando).toBe(true);
  });

  it('tempo ocioso do endereço: só inteiros entre 5 s e 1 h', () => {
    expect(lerOcioso('8')).toBe(8);
    expect(lerOcioso('3600')).toBe(3600);
    for (const v of [null, undefined, '', '4', '3601', '7.5', 'abc', '-10']) expect(lerOcioso(v)).toBe(OCIOSO_PADRAO_S);
  });

  it('intervalo do sinal de vida: só inteiros entre 5 s e 10 min', () => {
    expect(lerSinal('5')).toBe(5);
    for (const v of [null, '', '4', '601', '1.5', 'x']) expect(lerSinal(v)).toBe(SINAL_PADRAO_S);
  });
});
