import { Aviso, Cartao } from '@/components/ui';
import { apiNaPagina } from '@/lib/sessao';
import type { Me } from '@/lib/tipos';
import { FormMfa } from './form-mfa';

export default async function PaginaSeguranca() {
  const me = (await apiNaPagina<Me>('/me', '/painel/seguranca')).dados;
  return (
    <Cartao titulo="Verificação em duas etapas">
      {me.mfaAtivo ? (
        <Aviso tipo="sucesso">Ativa. No próximo login será pedido o código do aplicativo.</Aviso>
      ) : (
        <FormMfa />
      )}
    </Cartao>
  );
}
