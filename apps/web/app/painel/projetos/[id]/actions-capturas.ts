'use server';
import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { mensagem } from '@/lib/mensagens';
import { tokenParaAcao } from '@/lib/sessao';

const MENSAGENS: Record<string, string> = {
  arquivo_invalido_para_captura: 'O arquivo precisa ser um ZIP de fotos ou um vídeo já enviado.',
  captura_nao_esta_em_revisao: 'Esta captura não está mais em revisão.',
  captura_nao_pode_ser_cancelada: 'Esta captura não pode mais ser cancelada.',
  captura_nao_pode_ser_reenviada: 'Só dá para reenviar capturas com erro ou canceladas.',
  captura_sem_resultado: 'Esta captura ainda não tem 3D para ver.',
};
const explicar = (status: number, dados: unknown) => MENSAGENS[(dados as { erro?: string }).erro ?? ''] ?? mensagem(status, dados);

async function chamar(caminho: string, corpo: unknown, esperado: number, revalidar: string[]): Promise<{ erro?: string; dados?: unknown }> {
  const r = await api(caminho, { metodo: 'POST', corpo, token: await tokenParaAcao() });
  for (const c of revalidar) revalidatePath(c);
  return r.status === esperado ? { dados: r.dados } : { erro: explicar(r.status, r.dados) };
}

export async function criarCaptura(projetoId: string, nome: string, arquivoId: string) {
  return chamar(`/projetos/${projetoId}/capturas`, { nome, arquivoId }, 201, [`/painel/projetos/${projetoId}`]);
}
export async function cancelarCaptura(projetoId: string, id: string) {
  return chamar(`/capturas/${id}/cancelar`, {}, 200, [`/painel/projetos/${projetoId}`, `/painel/capturas/${id}`]);
}
export async function reenviarCaptura(projetoId: string, id: string) {
  return chamar(`/capturas/${id}/reenviar`, {}, 200, [`/painel/projetos/${projetoId}`, `/painel/capturas/${id}`]);
}
export async function publicarCaptura(projetoId: string, id: string) {
  return chamar(`/capturas/${id}/publicar`, {}, 200, [`/painel/projetos/${projetoId}`, `/painel/capturas/${id}`]);
}
/** Link curto da prévia (vence em 15 min): pedido na hora de abrir. */
export async function linkPrevia(id: string): Promise<{ url: string; nome: string } | null> {
  const r = await api<{ url: string; nome: string }>(`/capturas/${id}/previa`, { token: await tokenParaAcao() });
  return r.status === 200 ? r.dados : null;
}
