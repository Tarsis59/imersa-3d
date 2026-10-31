import { createHash } from 'node:crypto';

/** Tokens (refresh, convite) só existem com o cliente; o banco guarda o SHA-256. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
