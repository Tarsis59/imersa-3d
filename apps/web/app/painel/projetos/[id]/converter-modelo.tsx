'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Aviso, Botao } from '@/components/ui';
import { carregarAssimp, converterParaGlb, EXTENSOES_APOIO, EXTENSOES_CONVERSIVEIS, nomeDoGlb, arquivoPrincipal } from '@/lib/converter-modelo';
import { concluirEnvio, prepararEnvio } from './actions-arquivos';

/** FBX, OBJ, DAE, 3DS, STL → GLB convertido no navegador e enviado como “Modelo 3D” do empreendimento. */
export function ConverterModelo({ projetoId }: { projetoId: string }) {
  const router = useRouter();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [estado, setEstado] = useState<{ tipo: 'erro' | 'sucesso' | 'info'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function converter() {
    setOcupado(true);
    try {
      setEstado({ tipo: 'info', texto: 'Convertendo no seu navegador…' });
      const ajs = await carregarAssimp();
      const glb = converterParaGlb(ajs, await Promise.all(arquivos.map(async (f) => ({ nome: f.name, dados: new Uint8Array(await f.arrayBuffer()) }))));
      const nome = nomeDoGlb(arquivoPrincipal(arquivos.map((f) => f.name))!);
      setEstado({ tipo: 'info', texto: `Enviando ${nome}…` });
      const preparo = await prepararEnvio(projetoId, nome, 'modelo_3d', glb.byteLength);
      if (!preparo.ok) throw new Error(preparo.erro);
      const envio = await fetch(preparo.url, { method: preparo.metodo, headers: preparo.cabecalhos, body: new Blob([glb.slice()], { type: 'model/gltf-binary' }) });
      if (!envio.ok) throw new Error(`O armazenamento recusou o envio (${envio.status}).`);
      const fim = await concluirEnvio(projetoId, preparo.id);
      if (fim.status !== 'pronto') throw new Error(fim.erro ?? 'O modelo foi recusado na verificação.');
      setEstado({ tipo: 'sucesso', texto: `${nome} convertido e enviado. Ligue-o ao prédio na página do prédio (“Modelo 3D do prédio”).` });
      setArquivos([]);
      router.refresh();
    } catch (e) {
      setEstado({ tipo: 'erro', texto: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="grid gap-3 text-sm">
      <p className="text-suave">
        Modelos de outros programas viram GLB aqui mesmo, no seu navegador. Escolha o arquivo 3D e, se tiver, os materiais e texturas que vieram junto. SketchUp: exporte
        como DAE (Collada) ou IFC.
      </p>
      <label htmlFor="arquivo-converter" className="grid gap-1">
        <span className="font-medium">Arquivos ({[...EXTENSOES_CONVERSIVEIS, ...EXTENSOES_APOIO].join(' ')})</span>
        <input
          id="arquivo-converter"
          type="file"
          multiple
          accept={[...EXTENSOES_CONVERSIVEIS, ...EXTENSOES_APOIO].join(',')}
          onChange={(e) => setArquivos([...(e.target.files ?? [])])}
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-borda file:bg-superficie file:px-3 file:py-2"
        />
      </label>
      <div>
        <Botao type="button" onClick={converter} disabled={ocupado || !arquivoPrincipal(arquivos.map((f) => f.name))}>
          {ocupado ? 'Convertendo…' : 'Converter e enviar'}
        </Botao>
      </div>
      {estado && <Aviso tipo={estado.tipo}>{estado.texto}</Aviso>}
    </div>
  );
}
