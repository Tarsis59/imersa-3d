import { Aviso, Cartao } from '@/components/ui';
import { api } from '@/lib/api';
import { FormAceite } from './form-aceite';

interface InfoConvite {
  email: string;
  papel: string;
  empresa: string;
  temConta: boolean;
}

export default async function PaginaConvite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await api<InfoConvite>(`/convites/${encodeURIComponent(token)}`);
  return (
    <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">Convite</h1>
      {r.status !== 200 ? (
        <Aviso tipo="erro">Convite inválido, já usado ou expirado. Peça um novo para quem convidou você.</Aviso>
      ) : (
        <Cartao>
          <p className="mb-4 text-sm">
            Você foi convidado para <strong>{r.dados.empresa}</strong> como <strong>{r.dados.papel}</strong>, com o e-mail{' '}
            <strong>{r.dados.email}</strong>.
          </p>
          <FormAceite token={token} temConta={r.dados.temConta} />
        </Cartao>
      )}
    </main>
  );
}
