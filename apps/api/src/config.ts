import { z } from 'zod';

const chave32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64url').length === 32, 'TOTP_KEY precisa ter 32 bytes em base64url');

const Esquema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  TOTP_KEY: chave32,
  PORT: z.coerce.number().int().min(0).default(3333),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  WEB_URL: z.string().default('http://localhost:3000'),
  RATE_LIMIT_AUTH: z.coerce.number().int().positive().default(10),
  /** Só `true` atrás de um proxy confiável (produção); senão, qualquer um falsifica o IP. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SENTRY_DSN: z.string().optional(),
  AMBIENTE: z.string().default('dev'),
});

export type Config = z.infer<typeof Esquema>;

export const lerConfig = (env: NodeJS.ProcessEnv = process.env): Config => Esquema.parse(env);
