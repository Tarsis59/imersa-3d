import { migrate } from '@imersa/db';

/** Aplica as migrations no banco de E2E antes dos testes (chamada direta, sem processo externo). */
export default async function preparar(): Promise<void> {
  const aplicadas = await migrate('postgres://imersa_owner:imersa_owner_dev@localhost:55432/imersa_e2e');
  console.log(aplicadas.length ? `E2E: migrations aplicadas ${aplicadas.join(', ')}` : 'E2E: banco já atualizado');
}
