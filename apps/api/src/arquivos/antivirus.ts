import { connect } from 'node:net';
import { once } from 'node:events';
import type { Readable } from 'node:stream';

export interface ResultadoAntivirus {
  /** false quando não há antivírus configurado (o painel mostra isso). */
  verificado: boolean;
  limpo: boolean;
  ameaca?: string;
}

export interface Antivirus {
  verificar(conteudo: Readable): Promise<ResultadoAntivirus>;
}

export const semAntivirus: Antivirus = {
  async verificar(conteudo) {
    conteudo.destroy();
    return { verificado: false, limpo: true };
  },
};

const PARTE = 64 * 1024;

/** Cliente do clamd (protocolo INSTREAM). Qualquer falha vira erro: arquivo nunca é aprovado em silêncio. */
export function clamav(host: string, porta: number, tempoLimiteMs = 120_000): Antivirus {
  return {
    verificar: (conteudo) =>
      new Promise<ResultadoAntivirus>((resolve, reject) => {
        let resposta = '';
        let terminou = false;
        const socket = connect({ host, port: porta });
        const falhar = (e: Error) => {
          if (terminou) return;
          terminou = true;
          socket.destroy();
          conteudo.destroy();
          reject(e);
        };
        socket.setTimeout(tempoLimiteMs, () => falhar(new Error('antivírus não respondeu a tempo')));
        socket.on('error', falhar);
        socket.on('data', (d: Buffer) => {
          resposta += d.toString('latin1');
        });
        socket.on('close', () => {
          if (terminou) return;
          terminou = true;
          const r = resposta.replace(/\0/g, '').trim();
          if (/: OK$/.test(r)) return resolve({ verificado: true, limpo: true });
          const achou = r.match(/: (.+) FOUND$/);
          if (achou) return resolve({ verificado: true, limpo: false, ameaca: achou[1]! });
          reject(new Error(`resposta inesperada do antivírus: ${r || '(vazia)'}`));
        });
        socket.on('connect', async () => {
          try {
            socket.write('zINSTREAM\0');
            for await (const pedaco of conteudo) {
              const b = Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(pedaco as Uint8Array);
              for (let i = 0; i < b.length; i += PARTE) {
                const parte = b.subarray(i, i + PARTE);
                const tamanho = Buffer.alloc(4);
                tamanho.writeUInt32BE(parte.length);
                socket.write(tamanho);
                if (!socket.write(parte)) await once(socket, 'drain');
              }
            }
            socket.write(Buffer.alloc(4));
          } catch (e) {
            falhar(e as Error);
          }
        });
      }),
  };
}
