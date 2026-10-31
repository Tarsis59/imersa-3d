#!/bin/sh
# Sobe o Imersa 3D em produção: aplica as migrations pendentes (se houver DATABASE_URL_OWNER) e liga API + worker.
set -e
if [ -n "$DATABASE_URL_OWNER" ]; then
  node dist/migrate.mjs
fi
# MODO=api: só a API (quando o worker roda em outro serviço). Padrão: tudo num processo (hospedagem grátis).
if [ "$MODO" = "api" ]; then
  exec node --enable-source-maps dist/server.mjs
fi
exec node --enable-source-maps dist/tudo.mjs
