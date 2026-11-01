import Link from 'next/link';
import { Aviso } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import { ehGestao, type Me } from '@/lib/tipos';
import { Criar } from './criar';

export const metadata = { title: 'Criar com tudo · Imersa 3D' };

export default async function PaginaCriar() {
  const me = (await apiNaPagina<Me>('/me', '/painel/criar')).dados;
  return (
    <>
      <div>
        <Link href="/painel" className="text-sm text-suave hover:underline">
          ← Projetos
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Criar com tudo</h1>
        <p className="text-sm text-suave">
          Largue o que tiver (fotos, vídeo, planta, projeto BIM, planilha) e conte como é o empreendimento. Eu acho o lugar, monto a cidade em volta, gero o prédio com as unidades e o lazer, e
          deixo a Vitrine 3D pronta.
        </p>
      </div>
      {!ehGestao(me.papel) ? (
        <Aviso tipo="erro">Só a gestão da empresa cria empreendimentos.</Aviso>
      ) : !me.mfa ? (
        <Aviso>
          Ative a verificação em duas etapas para criar empreendimentos.{' '}
          <Link href="/painel/seguranca" className="font-semibold underline">
            Ativar agora
          </Link>
        </Aviso>
      ) : (
        <Criar />
      )}
    </>
  );
}
