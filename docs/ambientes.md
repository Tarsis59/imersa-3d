# Ambientes

| | Dev (esta máquina) | Staging | Produção |
|---|---|---|---|
| Banco | Docker local `:55432` | Postgres gerenciado com PostGIS (ex.: Supabase, RDS, Neon) | Igual a staging, com backup diário + PITR |
| API | `pnpm dev:api` (:3333) | Imagem `apps/api/Dockerfile` | Mesma imagem, 2+ réplicas |
| Site | `pnpm dev:web` (:3000) | `next build && next start` ou Vercel | Igual a staging |
| E2E | `pnpm e2e` (banco `imersa_e2e`, API :3334, site :3100) | Roda a cada deploy | — |

## Variáveis (API)

| Variável | Obrigatória | Observação |
|---|---|---|
| `DATABASE_URL` | sim | Papel **`imersa_app`** (sem superusuário, sem BYPASSRLS) |
| `DATABASE_URL_OWNER` | só nas migrations | Papel dono; **nunca** na API em execução |
| `JWT_SECRET` | sim | ≥ 48 bytes aleatórios, um por ambiente |
| `TOTP_KEY` | sim | 32 bytes base64url; trocar exige recifrar os segredos MFA |
| `WEB_URL`, `CORS_ORIGIN` | sim | URL pública do site |
| `TRUST_PROXY` | sim em prod | `true` só atrás de proxy/balanceador confiável |
| `RATE_LIMIT_AUTH` | não | Padrão 10/min por IP |
| `SENTRY_DSN`, `AMBIENTE` | não | Sentry desligado sem DSN |

## Variáveis (site)

| Variável | Observação |
|---|---|
| `API_URL` | URL **interna** da API (o navegador nunca chama a API direto) |

## Papéis do banco em staging/produção (sem as senhas de dev)

    CREATE ROLE imersa_app LOGIN PASSWORD '<gerada no cofre de segredos>' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT CONNECT ON DATABASE <banco> TO imersa_app;

Depois: `docker run --rm -e DATABASE_URL_OWNER=... imersa-api node dist/migrate.mjs`.

## Deploy (ordem)
1. Migrations (job único, com o papel dono).
2. API (rolling update; `/health` como health check).
3. Site.

## Pendente para ativar staging/produção
Escolher o provedor (banco, contêiner da API, site) e criar as contas. Os segredos ficam no cofre do provedor, nunca no repositório.
