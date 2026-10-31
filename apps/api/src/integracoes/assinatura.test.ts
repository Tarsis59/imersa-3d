import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { assinar, verificarAssinatura, proximaTentativaS, destinoPermitido } from './assinatura';

const SEGREDO = 'whsec_teste_1234567890';
const CORPO = JSON.stringify({ id: 'e1', evento: 'lead.criado', dados: { nome: 'Ana' } });
const AGORA = 1_800_000_000;

describe('assinatura dos webhooks (HMAC-SHA256)', () => {
  it('formato t=<segundos>,v1=<hex> sobre "<t>.<corpo>"', () => {
    const cab = assinar(SEGREDO, CORPO, AGORA);
    const esperado = createHmac('sha256', SEGREDO).update(`${AGORA}.${CORPO}`).digest('hex');
    expect(cab).toBe(`t=${AGORA},v1=${esperado}`);
  });

  it('o CRM confere: certa passa; corpo mexido, segredo errado, cabeçalho torto ou velha demais não passam', () => {
    const cab = assinar(SEGREDO, CORPO, AGORA);
    expect(verificarAssinatura(SEGREDO, cab, CORPO, AGORA + 10)).toBe(true);
    expect(verificarAssinatura(SEGREDO, cab, CORPO.replace('Ana', 'Eva'), AGORA)).toBe(false);
    expect(verificarAssinatura('outro-segredo', cab, CORPO, AGORA)).toBe(false);
    expect(verificarAssinatura(SEGREDO, 'lixo', CORPO, AGORA)).toBe(false);
    expect(verificarAssinatura(SEGREDO, `t=${AGORA},v1=abc`, CORPO, AGORA)).toBe(false);
    expect(verificarAssinatura(SEGREDO, cab, CORPO, AGORA + 301)).toBe(false); // reenvio de mensagem antiga
  });
});

describe('retentativa exponencial', () => {
  it('30 s, 1 min, 2 min… até 6 h; depois da 8ª tentativa, desiste', () => {
    expect([1, 2, 3, 4].map(proximaTentativaS)).toEqual([30, 60, 120, 240]);
    expect(proximaTentativaS(7)).toBe(1920);
    expect(proximaTentativaS(8)).toBeNull();
    expect(proximaTentativaS(20)).toBeNull();
  });
});

describe('destino do webhook (contra SSRF)', () => {
  it('só https público; rede interna, loopback e metadados da nuvem são recusados', async () => {
    expect(await destinoPermitido('https://93.184.216.34/webhook')).toBe(true);
    for (const url of ['http://93.184.216.34/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.10/x', 'https://172.16.3.4/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'https://0.0.0.0/x', 'ftp://exemplo.com', 'nada'])
      expect(await destinoPermitido(url), url).toBe(false);
  });

  it('em desenvolvimento pode liberar a rede local (receptor de teste)', async () => {
    expect(await destinoPermitido('http://127.0.0.1:4000/x', { permitirLocal: true })).toBe(true);
  });
});
