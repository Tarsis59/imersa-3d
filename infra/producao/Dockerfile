# Imersa 3D em produção num serviço só (hospedagem grátis): API + worker (capturas, webhooks, retenção) + motor Python.
# Build a partir da raiz do monorepo:  docker build -f infra/producao/Dockerfile -t imersa-servidor .
# O treino 3D roda na GPU grátis do Kaggle; aqui ficam só a validação das fotos, o desfoque de rostos e a compressão.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@imersa/api..." && pnpm --filter @imersa/api build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    RECONSTRUCAO_DIR=/app/reconstrucao \
    RECONSTRUCAO_PYTHON=/app/reconstrucao/.venv/bin/python \
    WORKER_PASTA=/tmp/imersa-trabalho \
    PYTHONUNBUFFERED=1
WORKDIR /app
# Python só para o motor de reconstrução (numpy + OpenCV sem interface + cliente do Kaggle)
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates wget && rm -rf /var/lib/apt/lists/*
COPY servicos/reconstrucao/pyproject.toml /app/reconstrucao/pyproject.toml
RUN python3 -m venv /app/reconstrucao/.venv \
 && /app/reconstrucao/.venv/bin/pip install --no-cache-dir "numpy>=2.0" "opencv-python-headless>=4.10" "kaggle>=2.2"
ENV PATH="/app/reconstrucao/.venv/bin:${PATH}"
COPY servicos/reconstrucao/imersa_recon /app/reconstrucao/imersa_recon
COPY servicos/reconstrucao/kaggle /app/reconstrucao/kaggle
COPY servicos/reconstrucao/modelos /app/reconstrucao/modelos
# compressão dos splats (versão fixa, já instalada: o npx não baixa nada na hora)
RUN npm install -g --no-audit --no-fund @playcanvas/splat-transform@3.10.3 \
 && npm install --omit=dev --no-save --no-audit --no-fund @node-rs/argon2@2.2.2 @sentry/node@11.10.0 \
 && npm cache clean --force
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/migrations ./migrations
COPY infra/producao/iniciar.sh ./iniciar.sh
RUN chmod +x iniciar.sh && mkdir -p /tmp/imersa-trabalho && chown -R node:node /tmp/imersa-trabalho /app
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-3333}/health || exit 1
CMD ["./iniciar.sh"]
