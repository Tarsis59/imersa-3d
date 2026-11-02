-- Plano 12, etapa 12b: ficha de cada área comum (item 6), galeria do empreendimento (item 7) e marca da
-- incorporadora (item 11).

-- Ficha do lazer: além do texto (já existia em "descricao"), a gestão escolhe fotos já enviadas no projeto.
ALTER TABLE lazer ADD COLUMN fotos uuid[] NOT NULL DEFAULT '{}'
  CHECK (array_length(fotos, 1) IS NULL OR array_length(fotos, 1) <= 12);

-- Galeria do empreendimento (drone, renders, fotos): a gestão escolhe quais fotos do projeto entram e a ordem.
CREATE TABLE galeria_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  ordem integer NOT NULL DEFAULT 0 CHECK (ordem BETWEEN 0 AND 200),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (building_id, asset_id)
);
CREATE INDEX galeria_fotos_predio_idx ON galeria_fotos (tenant_id, building_id, ordem);
ALTER TABLE galeria_fotos ENABLE ROW LEVEL SECURITY;
CREATE POLICY galeria_fotos_por_empresa ON galeria_fotos USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON galeria_fotos TO imersa_app;

-- Marca da incorporadora (cada empresa vê a própria marca no portal, no estande e na Vitrine). A tabela "tenants"
-- não tem RLS (é o próprio limite do tenant): a rota sempre restringe pelo id da sessão.
ALTER TABLE tenants
  ADD COLUMN logo_asset_id uuid REFERENCES assets (id) ON DELETE SET NULL,
  ADD COLUMN cor_primaria text CHECK (cor_primaria ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN fonte text NOT NULL DEFAULT 'sistema' CHECK (fonte IN ('sistema', 'inter', 'poppins', 'roboto', 'merriweather'));
