-- Estande de vendas (Plano 09, parte sem placa RTX): o PC com tela touch do estande abre a Vitrine em tela cheia.
-- Cada estande usa dois links do prédio: o do próprio PC (tipo 'estande', não aparece na lista de links das
-- consultoras) e o do QR code que o visitante leva no celular (link comum: os leads e visitas contam para o estande).
ALTER TABLE share_links ADD COLUMN tipo text NOT NULL DEFAULT 'cliente' CHECK (tipo IN ('cliente', 'estande'));

CREATE TABLE estandes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  link_id uuid NOT NULL UNIQUE,
  qr_link_id uuid NOT NULL UNIQUE,
  criado_por uuid DEFAULT app_user_id() REFERENCES users (id) ON DELETE SET NULL,
  -- sinal de vida do PC do estande (a cada minuto): online/offline, desempenho e tela, para o painel
  ultimo_sinal_em timestamptz,
  info jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(info) = 'object' AND length(info::text) <= 2000),
  -- comando remoto: o painel pede, o estande recarrega no próximo sinal (pega a versão nova do site)
  recarregar_pedido_em timestamptz,
  recarregado_em timestamptz,
  revogado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (link_id, tenant_id) REFERENCES share_links (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (qr_link_id, tenant_id) REFERENCES share_links (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id)
);
CREATE INDEX estandes_predio_idx ON estandes (tenant_id, building_id, criado_em DESC);

ALTER TABLE estandes ENABLE ROW LEVEL SECURITY;
CREATE POLICY estandes_por_empresa ON estandes USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON estandes TO imersa_app;
