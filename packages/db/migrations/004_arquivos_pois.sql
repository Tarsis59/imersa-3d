-- Arquivos do empreendimento (modelos 3D, splats, IFC, plantas, imagens, documentos).
-- O binário fica no armazenamento (disco local ou S3); aqui só metadados e o estado da verificação.
CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  project_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('modelo_3d', 'splat', 'ifc', 'planta', 'imagem', 'documento')),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 200),
  chave text NOT NULL UNIQUE CHECK (length(chave) BETWEEN 1 AND 500),
  tamanho_declarado bigint NOT NULL CHECK (tamanho_declarado > 0),
  tamanho bigint CHECK (tamanho >= 0),
  sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'aguardando_envio' CHECK (status IN ('aguardando_envio', 'verificando', 'pronto', 'rejeitado')),
  motivo_rejeicao text CHECK (length(motivo_rejeicao) <= 500),
  verificado_antivirus boolean NOT NULL DEFAULT false,
  enviado_por uuid REFERENCES users (id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id)
);
CREATE INDEX assets_projeto_idx ON assets (project_id, criado_em DESC);
CREATE TRIGGER assets_atualizado BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

-- Modelo 3D do prédio. Apagar o arquivo só desvincula (SET NULL apenas da coluna do arquivo, PostgreSQL 15+),
-- sem zerar o tenant_id, que também participa da chave composta.
ALTER TABLE buildings ADD COLUMN modelo_asset_id uuid;
ALTER TABLE buildings
  ADD CONSTRAINT buildings_modelo_fk FOREIGN KEY (modelo_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE SET NULL (modelo_asset_id);

-- Um nó (peça) do modelo 3D pertence a no máximo uma unidade do prédio.
CREATE UNIQUE INDEX units_no_3d_uk ON units (building_id, mesh_node_id) WHERE mesh_node_id IS NOT NULL;

-- Pontos de interesse ao redor do empreendimento.
CREATE TABLE pois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  project_id uuid NOT NULL,
  categoria text NOT NULL CHECK (categoria IN ('escola', 'saude', 'mercado', 'farmacia', 'transporte', 'parque', 'outro')),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 200),
  geom geometry(Point, 4326) NOT NULL,
  origem text NOT NULL CHECK (origem IN ('osm', 'manual')),
  osm_id text CHECK (osm_id ~ '^(node|way|relation)/[0-9]+$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, osm_id)
);
CREATE INDEX pois_geom_idx ON pois USING gist (geom);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pois ENABLE ROW LEVEL SECURITY;
CREATE POLICY assets_por_empresa ON assets USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY pois_por_empresa ON pois USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON assets, pois TO imersa_app;
