'use client';
import { useState, useTransition } from 'react';
import { Aviso, Botao, Selecao } from '@/components/ui';
import type { PreviaLotes } from './actions';

/**
 * Loteamento (Plano 12d): o desenho do parcelamento vira lotes clicáveis. DXF do AutoCAD (DWG → DXF pelo próprio
 * AutoCAD ou pelo ODA File Converter, grátis) com os lotes no layer LOTES e as quadras no layer QUADRAS, ou o
 * GeoJSON do QGIS com as colunas quadra e lote. Primeiro a prévia; nada é gravado sem confirmar.
 */
export function ImportarLotes({ importar }: { importar: (formato: 'dxf' | 'geojson', conteudo: string, fuso: number | null, aplicar: boolean) => Promise<PreviaLotes | { erro: string }> }) {
  const [arquivo, setArquivo] = useState<{ nome: string; formato: 'dxf' | 'geojson'; conteudo: string } | null>(null);
  const [fuso, setFuso] = useState('23');
  const [previa, setPrevia] = useState<PreviaLotes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const rodar = (aplicar: boolean) =>
    iniciar(async () => {
      if (!arquivo) return;
      setErro(null);
      const r = await importar(arquivo.formato, arquivo.conteudo, arquivo.formato === 'dxf' && fuso !== 'graus' ? Number(fuso) : null, aplicar);
      if ('erro' in r) return setErro(r.erro);
      setPrevia(r);
    });
  return (
    <div className="grid gap-3 text-sm" data-testid="importar-lotes">
      <p className="text-suave">
        Mande o DXF do parcelamento (lotes no layer <b>LOTES</b> com o número dentro, quadras no layer <b>QUADRAS</b> com &quot;Q-01&quot; dentro) ou o GeoJSON do QGIS (colunas <i>quadra</i> e <i>lote</i>). As medidas saem do desenho oficial.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_200px] sm:items-end">
        <label className="grid gap-1" htmlFor="arquivo-lotes">
          <span className="font-medium">Arquivo do loteamento</span>
          <input
            id="arquivo-lotes"
            type="file"
            accept=".dxf,.geojson,.json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setPrevia(null);
              setErro(null);
              if (!f) return setArquivo(null);
              if (f.size > 15 * 1024 * 1024) return setErro('Arquivo maior que 15 MB.');
              setArquivo({ nome: f.name, formato: /\.dxf$/i.test(f.name) ? 'dxf' : 'geojson', conteudo: await f.text() });
            }}
          />
        </label>
        <Selecao id="fuso-lotes" rotulo="Coordenadas do DXF" value={fuso} onChange={(e) => setFuso(e.target.value)} disabled={arquivo?.formato === 'geojson'}>
          {[18, 19, 20, 21, 22, 23, 24, 25].map((f) => (
            <option key={f} value={String(f)}>
              UTM SIRGAS 2000, fuso {f}
            </option>
          ))}
          <option value="graus">Latitude e longitude (graus)</option>
        </Selecao>
      </div>
      <div className="flex flex-wrap gap-2">
        <Botao type="button" variante="secundario" disabled={!arquivo || ocupado} onClick={() => rodar(false)}>
          Ver a prévia
        </Botao>
        <Botao type="button" disabled={!previa || previa.aplicado || previa.lotes === 0 || ocupado} onClick={() => rodar(true)}>
          Gravar os lotes
        </Botao>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {previa && (
        <div className="grid gap-1" data-testid="previa-lotes">
          <p>
            {previa.aplicado ? 'Gravado: ' : 'Prévia (nada foi gravado): '}
            <b>{previa.lotes} lotes</b> em {previa.quadras.length} quadras, {previa.areaTotalM2.toLocaleString('pt-BR')} m² no total.
          </p>
          {previa.avisos.length > 0 && (
            <ul className="list-disc pl-5 text-suave">
              {previa.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
