import { Aviso } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, type Me } from '@/lib/tipos';
import { apagarWebhook, criarChave, criarWebhook, revogarChave, testarWebhook } from './actions';
import { Integracoes, type DadosIntegracoes } from './integracoes';

export default async function PaginaIntegracoes() {
  const volta = '/painel/integracoes';
  const me = (await apiNaPagina<Me>('/me', volta)).dados;
  if (!ehGestao(me.papel)) return <Aviso>Só a gestão da empresa liga o Imersa 3D ao CRM.</Aviso>;
  const r = await apiNaPagina<DadosIntegracoes>('/integracoes', volta);
  if (r.status === 403) return <Aviso>Ative a verificação em duas etapas (Segurança) para gerenciar integrações: elas dão acesso aos leads.</Aviso>;
  if (r.status !== 200) return <Aviso tipo="erro">Não foi possível carregar as integrações agora.</Aviso>;
  return (
    <>
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">Integrações (CRM)</h1>
        <p className="text-sm text-suave">
          Leve leads e status das unidades para o seu CRM: por consulta à API (chave) ou recebendo avisos na hora (webhook assinado). Documentação técnica:{' '}
          <code>/openapi.json</code> da API.
        </p>
      </div>
      <Integracoes dados={r.dados} acoes={{ criarChave, revogarChave, criarWebhook, apagarWebhook, testarWebhook }} />
    </>
  );
}
