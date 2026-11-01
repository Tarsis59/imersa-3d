'use server';
import { api } from '@/lib/api';
import { TOKEN_LINK } from '@/lib/portal';

export interface DadosSinal {
  fps: number;
  largura: number;
  altura: number;
  apresentando: boolean;
}

/**
 * Sinal de vida do PC do estande (a cada minuto). `recarregar`: o painel pediu (pegar a versão nova do site);
 * `desativado`: a gestão desligou o estande.
 */
export async function enviarSinal(token: string, d: DadosSinal): Promise<{ status: 'ok'; recarregar: boolean } | { status: 'desativado' } | { status: 'erro' }> {
  if (!TOKEN_LINK.test(token)) return { status: 'desativado' };
  const r = await api<{ recarregar: boolean }>(`/publico/estandes/${token}/sinal`, {
    metodo: 'POST',
    corpo: {
      fps: Math.max(0, Math.min(1000, Math.round(d.fps))),
      largura: Math.max(0, Math.min(20_000, Math.round(d.largura))),
      altura: Math.max(0, Math.min(20_000, Math.round(d.altura))),
      apresentando: d.apresentando,
    },
  }).catch(() => null);
  if (!r) return { status: 'erro' };
  if (r.status === 410 || r.status === 404) return { status: 'desativado' };
  if (r.status !== 200) return { status: 'erro' };
  return { status: 'ok', recarregar: r.dados.recarregar };
}
