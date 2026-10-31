import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSAO = 'v1';

/** AES-256-GCM: `v1.<iv>.<tag>.<dados>` em base64url. A tag detecta qualquer alteração. */
export function cifrar(texto: string, chaveB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(chaveB64, 'base64url'), iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [VERSAO, iv.toString('base64url'), c.getAuthTag().toString('base64url'), dados.toString('base64url')].join('.');
}

export function decifrar(pacote: string, chaveB64: string): string {
  const [versao, iv, tag, dados] = pacote.split('.');
  if (versao !== VERSAO || !iv || !tag || !dados) throw new Error('formato cifrado inválido');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(chaveB64, 'base64url'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(dados, 'base64url')), d.final()]).toString('utf8');
}
