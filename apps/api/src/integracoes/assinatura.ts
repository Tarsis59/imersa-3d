import { createHmac, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Cabeçalho `X-Imersa-Assinatura: t=<segundos>,v1=<hex>`, HMAC-SHA256 de `"<t>.<corpo>"` com o segredo do webhook. */
export function assinar(segredo: string, corpo: string, agoraS = Math.floor(Date.now() / 1000)): string {
  return `t=${agoraS},v1=${createHmac('sha256', segredo).update(`${agoraS}.${corpo}`).digest('hex')}`;
}

/**
 * Referência de como o CRM confere a assinatura (também vai na documentação da API).
 * Recusa assinatura errada, corpo alterado e mensagens com mais de `toleranciaS` (reenvio de mensagem capturada).
 */
export function verificarAssinatura(segredo: string, cabecalho: string, corpo: string, agoraS = Math.floor(Date.now() / 1000), toleranciaS = 300): boolean {
  const m = cabecalho.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(agoraS - t) > toleranciaS) return false;
  const esperado = Buffer.from(createHmac('sha256', segredo).update(`${t}.${corpo}`).digest('hex'));
  const recebido = Buffer.from(m[2]!);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

export const MAX_TENTATIVAS = 8;

/** Espera antes da próxima tentativa (30 s × 2^(n−1), no máximo 6 h); `null` = desistir. */
export function proximaTentativaS(tentativasFeitas: number): number | null {
  if (tentativasFeitas >= MAX_TENTATIVAS) return null;
  return Math.min(30 * 2 ** (tentativasFeitas - 1), 6 * 3600);
}

/** IPv4/IPv6 de rede interna, loopback, link-local (inclui metadados da nuvem 169.254.169.254) ou não roteável. */
function ipInterno(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return ipInterno(x.slice(7));
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80');
}

/**
 * Contra SSRF: o webhook é um endereço escolhido pelo cliente, e a API não pode ser usada para alcançar a própria rede.
 * Exige https e que TODOS os IPs do nome sejam públicos (conferido na hora de cada envio, não só no cadastro).
 */
export async function destinoPermitido(url: string, opcoes: { permitirLocal?: boolean } = {}): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (opcoes.permitirLocal) return u.protocol === 'https:' || u.protocol === 'http:';
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [host] : await lookup(host, { all: true }).then((r) => r.map((x) => x.address), () => []);
  return ips.length > 0 && ips.every((ip) => !ipInterno(ip));
}
