'use client';
import { useEffect, useState } from 'react';
import { Botao, Campo, Cartao, Selecao } from '@/components/ui';
import { FONTES_MARCA, ROTULO_FONTE, type FonteMarca } from '@/lib/tipos';
import { fotosDoProjetoEscolhido, salvarMarca, type MarcaBruta } from './actions';

const COR_PADRAO = '#0369a1';

/** Formulário da marca da incorporadora (Plano 12b, item 11): logo, cor primária e fonte. */
export function FormularioMarca({ projetos, marcaInicial }: { projetos: Array<{ id: string; nome: string }>; marcaInicial: MarcaBruta | null }) {
  const [corPrimaria, setCorPrimaria] = useState(marcaInicial?.corPrimaria ?? COR_PADRAO);
  const [fonte, setFonte] = useState<FonteMarca>(marcaInicial?.fonte ?? 'sistema');
  const [logoAssetId, setLogoAssetId] = useState<string | null>(marcaInicial?.logoAssetId ?? null);
  const [projetoEscolhido, setProjetoEscolhido] = useState(projetos[0]?.id ?? '');
  const [fotos, setFotos] = useState<Array<{ id: string; nome: string }>>([]);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: true } | { ok: false; erro: string } | null>(null);

  useEffect(() => {
    if (!projetoEscolhido) {
      setFotos([]);
      return;
    }
    let vivo = true;
    void fotosDoProjetoEscolhido(projetoEscolhido).then((f) => {
      if (vivo) setFotos(f);
    });
    return () => {
      vivo = false;
    };
  }, [projetoEscolhido]);

  return (
    <Cartao titulo="Marca">
      <form
        className="grid gap-4"
        data-testid="formulario-marca"
        onSubmit={async (e) => {
          e.preventDefault();
          setSalvando(true);
          setResultado(null);
          const r = await salvarMarca({ corPrimaria, fonte, logoAssetId });
          setSalvando(false);
          setResultado(r.erro ? { ok: false, erro: r.erro } : { ok: true });
        }}
      >
        <Campo id="marca-cor" rotulo="Cor primária" type="color" value={corPrimaria} onChange={(e) => setCorPrimaria(e.target.value)} />
        <Selecao id="marca-fonte" rotulo="Fonte" value={fonte} onChange={(e) => setFonte(e.target.value as FonteMarca)}>
          {FONTES_MARCA.map((f) => (
            <option key={f} value={f}>
              {ROTULO_FONTE[f]}
            </option>
          ))}
        </Selecao>
        {projetos.length > 0 && (
          <>
            <Selecao id="marca-projeto" rotulo="Projeto com o arquivo do logo" value={projetoEscolhido} onChange={(e) => setProjetoEscolhido(e.target.value)}>
              {projetos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Selecao>
            <Selecao id="marca-logo" rotulo="Logo (foto já enviada no projeto)" value={logoAssetId ?? ''} onChange={(e) => setLogoAssetId(e.target.value || null)}>
              <option value="">Sem logo</option>
              {fotos.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </Selecao>
          </>
        )}
        <Botao type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar marca'}
        </Botao>
        {resultado && !resultado.ok && (
          <p role="alert" className="text-perigo">
            {resultado.erro}
          </p>
        )}
        {resultado?.ok && (
          <p role="status" className="text-sucesso">
            Marca salva.
          </p>
        )}
      </form>
    </Cartao>
  );
}
