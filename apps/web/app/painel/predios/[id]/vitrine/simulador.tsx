'use client';
import { useState } from 'react';
import { brl } from '@/lib/tipos';
import { PRAZO_MAXIMO_MESES, simular } from '@/lib/financiamento';

const numero = (v: string) => {
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

/** Simulação de financiamento (SAC e Price) da unidade, com entrada, FGTS, prazo e taxa ajustáveis. */
export function SimuladorFinanciamento({ preco }: { preco: number }) {
  const [entrada, setEntrada] = useState(String(Math.round(preco * 0.2)));
  const [fgts, setFgts] = useState('0');
  const [anos, setAnos] = useState('30');
  const [taxa, setTaxa] = useState('11,5');
  const r = simular({ preco, entrada: numero(entrada), fgts: numero(fgts), prazoMeses: numero(anos) * 12, taxaAnual: numero(taxa) });
  const campo = 'w-full rounded-lg border border-borda bg-superficie px-2 py-1.5';
  return (
    <details className="rounded-lg border border-borda" data-testid="simulador">
      <summary className="cursor-pointer px-3 py-2 font-semibold">Simular financiamento</summary>
      <div className="grid gap-3 px-3 pb-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs">
            Entrada (R$)
            <input className={campo} inputMode="numeric" value={entrada} onChange={(e) => setEntrada(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs">
            FGTS (R$)
            <input className={campo} inputMode="numeric" value={fgts} onChange={(e) => setFgts(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs">
            Prazo (anos)
            <input className={campo} inputMode="numeric" value={anos} onChange={(e) => setAnos(e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs">
            Juros ao ano (%)
            <input className={campo} inputMode="decimal" value={taxa} onChange={(e) => setTaxa(e.target.value)} />
          </label>
        </div>
        {r ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1" data-testid="resultado-simulacao">
            <dt className="text-suave">Financiado</dt>
            <dd>{brl(r.financiado)}</dd>
            <dt className="text-suave">SAC: 1ª parcela</dt>
            <dd data-testid="parcela-sac">{brl(r.sac.primeira)}</dd>
            <dt className="text-suave">SAC: última</dt>
            <dd>{brl(r.sac.ultima)}</dd>
            <dt className="text-suave">Price: parcela fixa</dt>
            <dd data-testid="parcela-price">{brl(r.price.parcela)}</dd>
            <dt className="text-suave">Renda sugerida</dt>
            <dd>{brl(r.rendaSugerida)}</dd>
          </dl>
        ) : (
          <p role="alert" className="text-perigo">
            Confira os valores: a entrada não pode cobrir o preço todo e o prazo vai até {PRAZO_MAXIMO_MESES / 12} anos.
          </p>
        )}
        <p className="text-xs text-suave">Simulação sem seguros e taxas do banco. As condições reais dependem da aprovação de crédito.</p>
      </div>
    </details>
  );
}
