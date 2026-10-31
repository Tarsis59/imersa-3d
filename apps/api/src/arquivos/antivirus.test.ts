import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:net';
import { Readable } from 'node:stream';
import { clamav, semAntivirus } from './antivirus';

/** Servidor falso que fala o protocolo INSTREAM do clamd e reconhece a assinatura de teste EICAR. */
let servidor: Server;
let porta = 0;
const recebidos: number[] = [];

beforeAll(async () => {
  servidor = createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const comando = 'zINSTREAM\0';
      if (buf.length < comando.length) return;
      if (buf.subarray(0, comando.length).toString('latin1') !== comando) {
        sock.end('UNKNOWN COMMAND\0');
        return;
      }
      let i = comando.length;
      const partes: Buffer[] = [];
      while (i + 4 <= buf.length) {
        const tamanho = buf.readUInt32BE(i);
        if (tamanho === 0) {
          const conteudo = Buffer.concat(partes);
          recebidos.push(conteudo.length);
          sock.end(conteudo.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
          return;
        }
        if (i + 4 + tamanho > buf.length) return;
        partes.push(buf.subarray(i + 4, i + 4 + tamanho));
        i += 4 + tamanho;
      }
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  porta = (servidor.address() as { port: number }).port;
});

afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

describe('antivírus (clamd INSTREAM)', () => {
  it('arquivo limpo', async () => {
    expect(await clamav('127.0.0.1', porta).verificar(Readable.from([Buffer.from('glTF conteúdo qualquer')]))).toEqual({ verificado: true, limpo: true });
  });

  it('arquivo infectado (EICAR)', async () => {
    expect(await clamav('127.0.0.1', porta).verificar(Readable.from([Buffer.from(EICAR)]))).toEqual({
      verificado: true,
      limpo: false,
      ameaca: 'Eicar-Test-Signature',
    });
  });

  it('envia arquivos grandes em partes de até 64 KB e chega tudo', async () => {
    const grande = Buffer.alloc(200_000, 7);
    await clamav('127.0.0.1', porta).verificar(Readable.from([grande]));
    expect(recebidos.at(-1)).toBe(200_000);
  });

  it('antivírus fora do ar vira erro (o arquivo não é aprovado em silêncio)', async () => {
    await expect(clamav('127.0.0.1', 1).verificar(Readable.from([Buffer.from('x')]))).rejects.toThrow();
  });

  it('sem antivírus configurado: aprova, mas marca como não verificado', async () => {
    expect(await semAntivirus.verificar(Readable.from([Buffer.from('x')]))).toEqual({ verificado: false, limpo: true });
  });
});
