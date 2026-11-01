import { describe, it, expect } from 'vitest';
import { lerEventos, type EventoSse } from './sse';

const fluxo = (pedacos: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pedacos) c.enqueue(new TextEncoder().encode(p));
      c.close();
    },
  });

describe('fluxo SSE (assistente)', () => {
  it('junta eventos cortados entre pedaços da rede, na ordem', async () => {
    const lidos: EventoSse[] = [];
    await lerEventos(fluxo(['event: texto\ndata: {"t":"Ol', 'á"}\n\nevent: acao\ndata: {"tipo":"mostrar","unidades":["a"],"focar":null}\n', '\nevent: fim\ndata: {"texto":"Olá"}\n\n']), (e) => lidos.push(e));
    expect(lidos).toEqual([
      { evento: 'texto', dados: { t: 'Olá' } },
      { evento: 'acao', dados: { tipo: 'mostrar', unidades: ['a'], focar: null } },
      { evento: 'fim', dados: { texto: 'Olá' } },
    ]);
  });

  it('ignora comentário, bloco sem dado e dado que não é JSON; acentos partidos no meio do byte', async () => {
    const lidos: EventoSse[] = [];
    const bytes = new TextEncoder().encode('event: texto\ndata: {"t":"ção"}\n\n');
    const corte = bytes.indexOf(0xc3) + 1; // no meio do "ç"
    const partes = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(': pulso\n\nevent: x\n\nevent: y\ndata: não-json\n\n'));
        c.enqueue(bytes.slice(0, corte));
        c.enqueue(bytes.slice(corte));
        c.close();
      },
    });
    await lerEventos(partes, (e) => lidos.push(e));
    expect(lidos).toEqual([{ evento: 'texto', dados: { t: 'ção' } }]);
  });
});

describe('fluxo SSE: erro de quem recebe', () => {
  it('sobe para quem chamou (a tela trata o evento `erro` lançando)', async () => {
    await expect(
      lerEventos(fluxo(['event: erro\ndata: {"codigo":"limite_ia"}\n\n']), () => {
        throw new Error('limite');
      }),
    ).rejects.toThrow('limite');
  });
});
