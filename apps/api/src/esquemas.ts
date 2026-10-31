import { z } from 'zod';
import { STATUS_UNIDADE } from './dominio/status';

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

// ------------------------------------------------------------------ empreendimentos
export const IdParam = z.object({ id: z.uuid() });

const textoOpcional = (max: number) => z.string().trim().max(max).nullable().optional();

export const AtualizarProjeto = z
  .object({
    nome: z.string().trim().min(2).max(120).optional(),
    descricao: textoOpcional(4000),
    endereco: textoOpcional(300),
    cidade: textoOpcional(120),
    uf: z.string().regex(/^[A-Z]{2}$/, 'UF com 2 letras maiúsculas').nullable().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    altitudeM: z.number().min(-500).max(9000).nullable().optional(),
    rotacaoGraus: z.number().min(-360).max(360).optional(),
    status: z.enum(['rascunho', 'lancamento', 'em_obra', 'pronto', 'arquivado']).optional(),
  })
  .refine((d) => (d.lat === undefined) === (d.lon === undefined), { message: 'informe lat e lon juntos', path: ['lat'] });

export const NovoPredio = z.object({
  nome: z.string().trim().min(1).max(60),
  andares: z.number().int().min(1).max(300),
  incluirTerreo: z.boolean().default(false),
});

export const NovaTipologia = z.object({
  nome: z.string().trim().min(1).max(60),
  areaM2: z.number().positive().max(99999),
  quartos: z.number().int().min(0).max(50),
  suites: z.number().int().min(0).max(50),
  vagas: z.number().int().min(0).max(50),
});

export const NovaUnidade = z.object({
  codigo: z.string().regex(/^[A-Za-z0-9-]{1,20}$/),
  andar: z.number().int().min(-10).max(300),
  tipologiaId: z.uuid().nullable().optional(),
  preco: z.number().min(0).max(999_999_999_999).nullable().optional(),
});

export const AtualizarUnidade = z.object({
  preco: z.number().min(0).max(999_999_999_999).nullable().optional(),
  tipologiaId: z.uuid().nullable().optional(),
  meshNodeId: z.string().trim().min(1).max(200).nullable().optional(),
});

export const MudarStatus = z.object({
  status: z.enum(STATUS_UNIDADE),
  motivo: z.string().trim().max(500).optional(),
});

export const Importacao = z.object({
  csv: z.string().min(1).max(2_000_000),
  aplicar: z.boolean().default(false),
});
