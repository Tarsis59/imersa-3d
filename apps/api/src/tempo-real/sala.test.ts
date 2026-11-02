import { describe, expect, it } from 'vitest';
import { entrega, type Sinal } from './sala';

const s = (o: Partial<Sinal>): Sinal => ({ t: 'emp', l: 'link', de: 'a', para: null, tipo: 'posicao', dados: {}, ...o });

describe('sala da visita em grupo', () => {
  it('chega a todos da mesma sala, menos a quem mandou', () => {
    expect(entrega(s({}), { t: 'emp', l: 'link', id: 'b' })).toBe(true);
    expect(entrega(s({}), { t: 'emp', l: 'link', id: 'a' })).toBe(false);
  });
  it('com destinatário, só ele recebe (oferta, resposta e ICE da voz)', () => {
    expect(entrega(s({ para: 'c', tipo: 'oferta' }), { t: 'emp', l: 'link', id: 'b' })).toBe(false);
    expect(entrega(s({ para: 'c', tipo: 'oferta' }), { t: 'emp', l: 'link', id: 'c' })).toBe(true);
  });
  it('outro link ou outra empresa nunca recebe', () => {
    expect(entrega(s({}), { t: 'emp', l: 'outro', id: 'b' })).toBe(false);
    expect(entrega(s({}), { t: 'outra', l: 'link', id: 'b' })).toBe(false);
  });
});
