-- Lazer do empreendimento (Plano 09b, item 13): piscina, academia, salão... marcados no 3D do prédio, com o tour
-- "Conheça o lazer" na Vitrine. A posição fica nos eixos da cena do prédio (metros; y = altura do piso marcado).
CREATE TABLE lazer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  categoria text NOT NULL CHECK (categoria IN ('piscina', 'academia', 'salao_festas', 'churrasqueira', 'playground', 'quadra', 'espaco_gourmet', 'brinquedoteca', 'coworking', 'pet', 'jardim', 'outro')),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  descricao text CHECK (length(descricao) <= 600),
  x_m double precision NOT NULL CHECK (abs(x_m) <= 2000),
  y_m double precision NOT NULL DEFAULT 0 CHECK (y_m BETWEEN -50 AND 600),
  z_m double precision NOT NULL CHECK (abs(z_m) <= 2000),
  -- ordem no tour (menor primeiro)
  ordem integer NOT NULL DEFAULT 0 CHECK (ordem BETWEEN 0 AND 1000),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id)
);
CREATE INDEX lazer_predio_idx ON lazer (tenant_id, building_id, ordem);

ALTER TABLE lazer ENABLE ROW LEVEL SECURITY;
CREATE POLICY lazer_por_empresa ON lazer USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON lazer TO imersa_app;

-- tour do lazer completo: evento nos Números do empreendimento
ALTER TABLE view_events DROP CONSTRAINT view_events_tipo_check;
ALTER TABLE view_events ADD CONSTRAINT view_events_tipo_check CHECK (tipo IN ('abriu', 'unidade', 'favorito', 'interior', 'tempo', 'tour_lazer'));
