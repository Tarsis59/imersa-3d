import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Aviso, Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { COR_STATUS, ehGestao, ROTULO_STATUS, ROTULO_STATUS_PROJETO, STATUS_UNIDADE, type DetalheProjeto, type Me } from '@/lib/tipos';
import { criarPredio, criarTipologia, importar, salvarDados } from './actions';
import { FormDados, FormImportacao, FormPredio, FormTipologia } from './formularios';

function BarraSituacao({ resumo }: { resumo: DetalheProjeto['resumo'] }) {
  if (resumo.total === 0) return <p className="text-suave">Nenhuma unidade cadastrada ainda. Use a importação de planilha abaixo.</p>;
  return (
    <div className="grid gap-3">
      <div className="flex h-4 overflow-hidden rounded-full bg-fundo" role="img" aria-label="Proporção de unidades por status">
        {STATUS_UNIDADE.filter((s) => resumo[s] > 0).map((s) => (
          <div key={s} className={COR_STATUS[s]} style={{ width: `${(resumo[s] / resumo.total) * 100}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm" data-testid="resumo-status">
        {STATUS_UNIDADE.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <span className={`inline-block size-3 rounded-sm ${COR_STATUS[s]}`} aria-hidden />
            {ROTULO_STATUS[s]}: <strong className="tabular-nums">{resumo[s]}</strong>
          </li>
        ))}
        <li className="text-suave">
          Total: <strong className="tabular-nums">{resumo.total}</strong>
        </li>
      </ul>
    </div>
  );
}

export default async function PaginaProjeto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const volta = `/painel/projetos/${id}`;
  const me = (await apiNaPagina<Me>('/me', volta)).dados;
  const r = await apiNaPagina<DetalheProjeto>(`/projetos/${encodeURIComponent(id)}`, volta);
  if (r.status !== 200) notFound();
  const { projeto, predios, tipologias, resumo } = r.dados;
  const gestao = ehGestao(me.papel);
  const podeEditar = gestao && me.mfa;

  return (
    <>
      <div className="grid gap-1">
        <Link href="/painel" className="text-sm text-suave hover:underline">
          ← Projetos
        </Link>
        <h1 className="text-2xl font-bold">{projeto.nome}</h1>
        <p className="text-sm text-suave">
          {ROTULO_STATUS_PROJETO[projeto.status]}
          {projeto.cidade ? ` · ${projeto.cidade}${projeto.uf ? `/${projeto.uf}` : ''}` : ''}
        </p>
      </div>

      {gestao && !me.mfa && (
        <Aviso>
          Para editar este empreendimento, ative a verificação em duas etapas.{' '}
          <Link href="/painel/seguranca" className="font-semibold underline">
            Ativar agora
          </Link>
        </Aviso>
      )}

      <Cartao titulo="Situação das unidades">
        <BarraSituacao resumo={resumo} />
      </Cartao>

      <Cartao titulo="Prédios">
        {predios.length === 0 ? (
          <p className="mb-4 text-suave">Nenhum prédio ainda.</p>
        ) : (
          <ul className="mb-4 divide-y divide-borda">
            {predios.map((p) => (
              <li key={p.id}>
                <Link href={`/painel/predios/${p.id}`} className="flex flex-wrap justify-between gap-2 py-3 hover:underline">
                  <span className="font-medium">{p.nome}</span>
                  <span className="text-sm text-suave">
                    {p.andares} {p.andares === 1 ? 'andar' : 'andares'} · {p.unidades} {p.unidades === 1 ? 'unidade' : 'unidades'} · ver espelho de vendas
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {podeEditar && <FormPredio acao={criarPredio.bind(null, projeto.id)} />}
      </Cartao>

      <Cartao titulo="Tipologias">
        {tipologias.length === 0 ? (
          <p className="mb-4 text-suave">Nenhuma tipologia ainda.</p>
        ) : (
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-suave">
                <tr>
                  <th className="py-2 pr-4 font-medium">Nome</th>
                  <th className="py-2 pr-4 font-medium">Área</th>
                  <th className="py-2 pr-4 font-medium">Quartos</th>
                  <th className="py-2 pr-4 font-medium">Suítes</th>
                  <th className="py-2 font-medium">Vagas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {tipologias.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-4">{t.nome}</td>
                    <td className="py-2 pr-4 tabular-nums">{t.areaM2.toLocaleString('pt-BR')} m²</td>
                    <td className="py-2 pr-4 tabular-nums">{t.quartos}</td>
                    <td className="py-2 pr-4 tabular-nums">{t.suites}</td>
                    <td className="py-2 tabular-nums">{t.vagas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {podeEditar && <FormTipologia acao={criarTipologia.bind(null, projeto.id)} />}
      </Cartao>

      {podeEditar && (
        <Cartao titulo="Importar unidades por planilha">
          <FormImportacao previa={importar.bind(null, projeto.id, false)} aplicar={importar.bind(null, projeto.id, true)} />
        </Cartao>
      )}

      <Cartao titulo="Dados do empreendimento">
        {podeEditar ? (
          <FormDados projeto={projeto} acao={salvarDados.bind(null, projeto.id)} />
        ) : (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-suave">Endereço</dt>
            <dd>{projeto.endereco ?? '—'}</dd>
            <dt className="text-suave">Localização</dt>
            <dd className="tabular-nums">{projeto.lat !== null && projeto.lon !== null ? `${projeto.lat}, ${projeto.lon}` : '—'}</dd>
            <dt className="text-suave">Descrição</dt>
            <dd>{projeto.descricao ?? '—'}</dd>
          </dl>
        )}
      </Cartao>
    </>
  );
}
