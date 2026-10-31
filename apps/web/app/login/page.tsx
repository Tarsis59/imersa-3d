import { Cartao } from '@/components/ui';
import { FormLogin } from './form';

export default async function PaginaLogin({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const { empresa } = await searchParams;
  return (
    <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">Imersa 3D</h1>
        <p className="text-suave">Entre na sua empresa</p>
      </div>
      <Cartao>
        <FormLogin empresaInicial={empresa} />
      </Cartao>
    </main>
  );
}
