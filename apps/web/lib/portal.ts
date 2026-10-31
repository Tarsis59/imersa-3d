import 'server-only';
import { cache } from 'react';
import { api, type RespostaApi } from './api';
import type { Portal } from './tipos';

/** Formato do token do link (32 bytes em base64url): qualquer outra coisa nem chega à API. */
export const TOKEN_LINK = /^[\w-]{43}$/;

/** Dados do portal pelo token. `cache`: a página, os metadados e a imagem de prévia pedem uma vez só por acesso. */
export const buscarPortal = cache(async (token: string): Promise<RespostaApi<Portal> | null> => {
  if (!TOKEN_LINK.test(token)) return null;
  return api<Portal>(`/publico/links/${token}`);
});
