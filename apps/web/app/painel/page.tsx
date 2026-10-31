import Link from 'next/link';
import { Aviso, Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, type Me, type Projeto } from '@/lib/tipos';
import { FormProjeto } from './form-projeto';

export default async function Painel() {
  const me = (await apiNaPagina<Me>('/me', '/painel')).dados;
  const projetos = (await apiNaPagina<Projeto[]>('/projetos', '/painel')).dados;
  const empresa = me.empresas.find((e) => e.id === me.tenantId);
  const gestao = ehGestao(me.papel);
  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{empresa?.nome ?? 'Painel'}</h1>
        <p className="text-sm text-suave">
          {me.nome} · {me.papel}
        </p>
      </div>
      {gestao && !me.mfa && (
        <Aviso>
          Ative a verificação em duas etapas para criar projetos e convidar pessoas.{' '}
          <Link href="/painel/seguranca" className="font-semibold underline">
            Ativar agora
          </Link>
        </Aviso>
      )}
      <Cartao titulo="Projetos">
        {projetos.length === 0 ? (
          <p className="text-suave">Nenhum projeto ainda.</p>
        ) : (
          <ul className="divide-y divide-borda" data-testid="lista-projetos">
            {projetos.map((p) => (
              <li key={p.id} className="py-2">
                {p.nome}
              </li>
            ))}
          </ul>
        )}
      </Cartao>
      {gestao && me.mfa && (
        <Cartao titulo="Novo projeto">
          <FormProjeto />
        </Cartao>
      )}
    </>
  );
}
