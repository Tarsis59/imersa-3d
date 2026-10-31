import { z } from 'zod';

const email = z.email().max(254).transform((e) => e.toLowerCase());
const senha = z.string().min(10, 'mínimo de 10 caracteres').max(200);
const tokenOpaco = z.string().min(20).max(200);

export const Registro = z.object({
  empresa: z.object({
    nome: z.string().trim().min(2).max(120),
    slug: z.string().regex(/^[a-z0-9-]{3,40}$/, 'use letras minúsculas, números e hífen (3 a 40)'),
  }),
  nome: z.string().trim().min(2).max(120),
  email,
  senha,
});

export const Login = z.object({
  email,
  senha: z.string().min(1).max(200),
  empresa: z.string().min(1).max(40),
  codigoMfa: z.string().regex(/^\d{6}$/).optional(),
});

export const Refresh = z.object({ refresh: tokenOpaco });
export const Sair = z.object({ refresh: tokenOpaco });
export const NovoProjeto = z.object({ nome: z.string().trim().min(2).max(120) });
export const MfaConfirmar = z.object({ codigo: z.string().regex(/^\d{6}$/) });
export const NovoConvite = z.object({ email, papel: z.enum(['admin', 'consultora', 'produtor', 'viewer']) });
export const TokenConvite = z.object({ token: tokenOpaco });
export const AceitarConvite = z.object({ token: tokenOpaco, senha, nome: z.string().trim().min(2).max(120).optional() });
