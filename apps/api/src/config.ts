import { z } from 'zod';

const Esquema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  PORT: z.coerce.number().int().min(0).default(3333),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  RATE_LIMIT_AUTH: z.coerce.number().int().positive().default(10),
});

export type Config = z.infer<typeof Esquema>;

export const lerConfig = (env: NodeJS.ProcessEnv = process.env): Config => Esquema.parse(env);
