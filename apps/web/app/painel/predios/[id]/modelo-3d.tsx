'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { Aviso, Botao, Selecao } from '@/components/ui';
import type { Arquivo } from '@/lib/tipos';
import type { EstadoModelo } from './actions';

export function ModeloDoPredio({
  predioId,
  modeloAtual,
  modelos,
  podeEditar,
  acao,
}: {
  predioId: string;
  modeloAtual: string | null;
  modelos: Arquivo[];
  podeEditar: boolean;
  acao: (e: EstadoModelo, f: FormData) => Promise<EstadoModelo>;
}) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const atual = modelos.find((m) => m.id === modeloAtual);
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        {atual ? (
          <>
            Modelo atual: <strong>{atual.nome}</strong> ·{' '}
            <Link href={`/painel/predios/${predioId}/3d`} className="font-semibold underline">
              Abrir no 3D e ligar peças às unidades
            </Link>
          </>
        ) : (
          <span className="text-suave">Nenhum modelo 3D ligado a este prédio.</span>
        )}
      </p>
      {podeEditar &&
        (modelos.length === 0 ? (
          <p className="text-sm text-suave">Envie um modelo .glb na página do empreendimento (Arquivos 3D e documentos).</p>
        ) : (
          <form action={enviar} className="flex flex-wrap items-end gap-3">
            <Selecao id="arquivo-modelo" name="arquivoId" rotulo="Modelo 3D do prédio" defaultValue={modeloAtual ?? ''}>
              <option value="">Nenhum</option>
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </Selecao>
            <Botao type="submit" variante="secundario" disabled={pendente}>
              Salvar modelo
            </Botao>
          </form>
        ))}
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.ok && <Aviso tipo="sucesso">{estado.ok}</Aviso>}
    </div>
  );
}
