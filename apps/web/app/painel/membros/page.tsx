import Link from 'next/link';
import { Aviso, Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { mensagem } from '@/lib/mensagens';
import { FormConvite } from './form-convite';

interface Membros {
  membros: Array<{ id: string; nome: string; email: string; papel: string }>;
  convites: Array<{ id: string; email: string; papel: string; expira_em: string }>;
}

export default async function PaginaMembros() {
  const r = await apiNaPagina<Membros>('/membros', '/painel/membros');
  if (r.status !== 200) {
    return (
      <Aviso tipo="erro">
        {mensagem(r.status, r.dados)}{' '}
        {(r.dados as unknown as { erro?: string }).erro === 'mfa_requerido' && (
          <Link href="/painel/seguranca" className="font-semibold underline">
            Ativar agora
          </Link>
        )}
      </Aviso>
    );
  }
  return (
    <>
      <Cartao titulo="Membros">
        <ul className="divide-y divide-borda">
          {r.dados.membros.map((m) => (
            <li key={m.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                {m.nome} <span className="text-suave">({m.email})</span>
              </span>
              <span className="text-sm text-suave">{m.papel}</span>
            </li>
          ))}
        </ul>
        {r.dados.convites.length > 0 && (
          <>
            <h3 className="mt-6 mb-2 font-semibold">Convites pendentes</h3>
            <ul className="divide-y divide-borda text-sm">
              {r.dados.convites.map((c) => (
                <li key={c.id} className="py-2">
                  {c.email} · {c.papel} · expira em {new Date(c.expira_em).toLocaleDateString('pt-BR')}
                </li>
              ))}
            </ul>
          </>
        )}
      </Cartao>
      <Cartao titulo="Convidar pessoa">
        <FormConvite />
      </Cartao>
    </>
  );
}
