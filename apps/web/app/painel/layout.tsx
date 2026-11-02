import Link from 'next/link';
import type { ReactNode } from 'react';
import { Botao } from '@/components/ui';
import { sair } from '../login/actions';

export default function LayoutPainel({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-4 py-6">
      <header className="flex flex-wrap items-center gap-4">
        <strong className="text-lg">Imersa 3D</strong>
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/painel" className="hover:underline">
            Projetos
          </Link>
          <Link href="/painel/leads" className="hover:underline">
            Leads
          </Link>
          <Link href="/painel/catalogo" className="hover:underline">
            Catálogo
          </Link>
          <Link href="/painel/membros" className="hover:underline">
            Membros
          </Link>
          <Link href="/painel/seguranca" className="hover:underline">
            Segurança
          </Link>
          <Link href="/painel/telemetria" className="hover:underline">
            Desempenho 3D
          </Link>
          <Link href="/painel/integracoes" className="hover:underline">
            Integrações
          </Link>
          <Link href="/painel/marca" className="hover:underline">
            Marca
          </Link>
        </nav>
        <form action={sair} className="ml-auto">
          <Botao variante="secundario" type="submit">
            Sair
          </Botao>
        </form>
      </header>
      <main className="grid gap-6">{children}</main>
    </div>
  );
}
