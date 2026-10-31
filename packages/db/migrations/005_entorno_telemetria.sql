-- Entorno: prédios reais do OpenStreetMap em volta do projeto (cache, para não consultar o OSM a cada visita).
CREATE TABLE entornos (
  project_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  centro geometry(Point, 4326) NOT NULL,
  raio_m integer NOT NULL CHECK (raio_m BETWEEN 100 AND 2000),
  predios jsonb NOT NULL CHECK (jsonb_typeof(predios) = 'array'),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE
);

-- Telemetria do viewer: só anotar (sem alterar nem apagar pela aplicação).
CREATE TABLE telemetria_viewer (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  user_id uuid DEFAULT app_user_id(),
  carga_ms integer CHECK (carga_ms BETWEEN 0 AND 600000),
  fps_medio numeric(5, 1) CHECK (fps_medio BETWEEN 0 AND 500),
  nivel text CHECK (nivel IN ('alto', 'medio', 'baixo')),
  erros integer NOT NULL DEFAULT 0 CHECK (erros BETWEEN 0 AND 1000),
  celular boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX telemetria_viewer_data_idx ON telemetria_viewer (tenant_id, criado_em DESC);

ALTER TABLE entornos ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetria_viewer ENABLE ROW LEVEL SECURITY;
CREATE POLICY entornos_por_empresa ON entornos USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY telemetria_por_empresa ON telemetria_viewer USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON entornos TO imersa_app;
GRANT SELECT, INSERT ON telemetria_viewer TO imersa_app;
