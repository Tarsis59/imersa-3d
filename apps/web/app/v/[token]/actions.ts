'use server';
import type { Entorno } from '@imersa/viewer';
import { api } from '@/lib/api';
import { TOKEN_LINK } from '@/lib/portal';
import type { ResultadoEntorno } from '@/app/painel/predios/[id]/vitrine/actions';

const caminho = (token: string, resto = '') => {
  if (!TOKEN_LINK.test(token)) throw new Error('link inválido');
  return `/publico/links/${token}${resto}`;
};

export async function carregarEntornoPublico(token: string): Promise<ResultadoEntorno> {
  const r = await api<{ semLocalizacao: boolean; centro: Entorno['centro'] | null; predios: Entorno['predios']; atribuicao: string }>(caminho(token, '/entorno'));
  if (r.status !== 200) return { entorno: null, motivo: 'indisponivel' };
  if (r.dados.semLocalizacao || !r.dados.centro) return { entorno: null, motivo: 'sem_localizacao' };
  return { entorno: { centro: r.dados.centro, predios: r.dados.predios, atribuicao: r.dados.atribuicao } };
}

export async function linkArquivoPublico(token: string, arquivoId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(arquivoId)) return null;
  const r = await api<{ url: string }>(caminho(token, `/arquivos/${arquivoId}`));
  return r.status === 200 ? r.dados.url : null;
}

export interface DadosLead {
  nome: string;
  telefone: string;
  email: string;
  mensagem: string;
  unidadeId: string;
  consentimento: boolean;
  textoConsentimento: string;
}

/** Pedido de contato do cliente. A API recusa sem consentimento e guarda a prova (texto, data, IP, navegador). */
export async function enviarLead(token: string, d: DadosLead): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!d.consentimento) return { ok: false, erro: 'Marque a autorização para podermos entrar em contato.' };
  if (!d.telefone.trim() && !d.email.trim()) return { ok: false, erro: 'Informe um telefone ou um e-mail.' };
  const r = await api<{ erro?: string }>(caminho(token, '/leads'), {
    metodo: 'POST',
    corpo: {
      nome: d.nome,
      ...(d.telefone.trim() ? { telefone: d.telefone } : {}),
      ...(d.email.trim() ? { email: d.email } : {}),
      ...(d.mensagem.trim() ? { mensagem: d.mensagem } : {}),
      ...(d.unidadeId ? { unidadeId: d.unidadeId } : {}),
      consentimento: d.consentimento,
      textoConsentimento: d.textoConsentimento,
    },
  });
  if (r.status === 201) return { ok: true };
  if (r.status === 410) return { ok: false, erro: 'Este link não está mais disponível. Peça um novo à sua consultora.' };
  if (r.status === 429) return { ok: false, erro: 'Muitos envios seguidos. Tente de novo em alguns minutos.' };
  return { ok: false, erro: 'Confira os dados: nome, e-mail ou telefone (com DDD).' };
}
