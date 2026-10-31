const MENSAGENS: Record<string, string> = {
  credenciais_invalidas: 'E-mail, senha ou empresa incorretos.',
  mfa_obrigatorio: 'Digite o código de 6 dígitos do aplicativo autenticador.',
  mfa_invalido: 'Código inválido. Use o código que aparece agora no aplicativo.',
  mfa_requerido: 'Ative a verificação em duas etapas para fazer isso.',
  sem_permissao: 'Seu papel não permite esta ação.',
  dados_invalidos: 'Confira os campos.',
  ja_existe: 'Já existe um cadastro com esses dados.',
  codigo_invalido: 'Código inválido. Tente o código atual.',
  convite_invalido: 'Convite inválido, já usado ou expirado.',
  nome_obrigatorio: 'Informe seu nome.',
  ja_e_membro: 'Você já faz parte desta empresa.',
};

export function mensagem(status: number, dados: unknown): string {
  if (status === 429) return 'Muitas tentativas. Aguarde um minuto.';
  const codigo = (dados as { erro?: string } | undefined)?.erro;
  return (codigo && MENSAGENS[codigo]) || 'Algo deu errado. Tente de novo.';
}
