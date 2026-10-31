import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type Variante = 'primario' | 'secundario' | 'perigo';
const VARIANTES: Record<Variante, string> = {
  primario: 'bg-acento text-acento-texto hover:opacity-90',
  secundario: 'border border-borda bg-superficie hover:bg-fundo',
  perigo: 'bg-perigo text-white hover:opacity-90',
};

export function Botao({ variante = 'primario', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTES[variante]} ${className}`}
      {...p}
    />
  );
}

const ESTILO_ENTRADA =
  'w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-base outline-none focus:border-acento focus:ring-2 focus:ring-acento/30';

export function Campo({ rotulo, erro, id, ...p }: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; erro?: string; id: string }) {
  return (
    <label htmlFor={id} className="grid gap-1 text-sm">
      <span className="font-medium">{rotulo}</span>
      <input id={id} className={ESTILO_ENTRADA} aria-invalid={erro ? true : undefined} {...p} />
      {erro && <span className="text-perigo">{erro}</span>}
    </label>
  );
}

export function Selecao({ rotulo, id, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { rotulo: string; id: string }) {
  return (
    <label htmlFor={id} className="grid gap-1 text-sm">
      <span className="font-medium">{rotulo}</span>
      <select id={id} className={ESTILO_ENTRADA} {...p}>
        {children}
      </select>
    </label>
  );
}

export function Cartao({ titulo, children }: { titulo?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-borda bg-superficie p-6 shadow-sm">
      {titulo && <h2 className="mb-4 text-lg font-semibold">{titulo}</h2>}
      {children}
    </section>
  );
}

type TipoAviso = 'info' | 'erro' | 'sucesso';
const AVISOS: Record<TipoAviso, string> = {
  info: 'border-acento/40 bg-acento/10',
  erro: 'border-perigo/40 bg-perigo/10 text-perigo',
  sucesso: 'border-sucesso/40 bg-sucesso/10',
};

export function Aviso({ tipo = 'info', children }: { tipo?: TipoAviso; children: ReactNode }) {
  return (
    <div role={tipo === 'erro' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${AVISOS[tipo]}`}>
      {children}
    </div>
  );
}
