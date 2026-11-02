-- Loteamento (Plano 12d): os lotes do parcelamento, vindos do DXF/DWG ou do GeoJSON, com quadra, número, medidas,
-- preço e situação de venda. Ficam presos a um "prédio" do projeto (o loteamento), para o link do cliente, o
-- estande, a Vitrine e os leads funcionarem como nas unidades.
CREATE TABLE lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  quadra text NOT NULL CHECK (length(quadra) BETWEEN 1 AND 20),
  numero text NOT NULL CHECK (length(numero) BETWEEN 1 AND 20),
  -- medidas calculadas do desenho oficial (nunca redesenhadas à mão)
  area_m2 numeric(12, 2) NOT NULL CHECK (area_m2 > 0),
  frente_m numeric(8, 2) CHECK (frente_m > 0),
  fundo_m numeric(8, 2) CHECK (fundo_m > 0),
  preco numeric(14, 2) CHECK (preco >= 0),
  status text NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel', 'reservado', 'vendido', 'bloqueado')),
  contorno geometry(Polygon, 4326) NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (building_id, quadra, numero),
  UNIQUE (id, tenant_id)
);
CREATE INDEX lotes_predio_idx ON lotes (tenant_id, building_id, quadra, numero);

ALTER TABLE lotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY lotes_por_empresa ON lotes USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON lotes TO imersa_app;
