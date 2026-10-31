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
  // Arquivos (Plano 03b). Opcionais no tipo: os padrões ficam em construirApp.
  ARMAZENAMENTO: z.enum(['local', 's3']).optional(),
  ARMAZENAMENTO_PASTA: z.string().optional(),
  /** URL da API vista pelo navegador (links do armazenamento local). */
  API_URL_PUBLICA: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGIAO: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORTA: z.coerce.number().int().positive().optional(),
  LIMITE_ARMAZENAMENTO_GB: z.coerce.number().positive().optional(),
  /** Identificação exigida pelo Nominatim/Overpass (em produção: nome e contato reais). */
  OSM_USER_AGENT: z.string().optional(),
  /** Arquivo do Overpass já baixado: prédios do entorno sem internet (testes e demonstração). */
  MAPA_ARQUIVO_PREDIOS: z.string().optional(),
});

export type Config = z.infer<typeof Esquema>;

export const lerConfig = (env: NodeJS.ProcessEnv = process.env): Config => Esquema.parse(env);
