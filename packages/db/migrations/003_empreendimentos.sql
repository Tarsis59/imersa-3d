-- Toda tabela "pai" ganha UNIQUE (id, tenant_id) e todo filho referencia (pai_id, tenant_id).
-- Motivo: a checagem de chave estrangeira NÃO passa pelo RLS. Sem a chave composta, quem soubesse
-- o UUID de um registro de outra empresa conseguiria pendurar dados nele.

CREATE FUNCTION tocar_atualizado_em() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;

ALTER TABLE projects ADD CONSTRAINT projects_id_tenant_uk UNIQUE (id, tenant_id);
ALTER TABLE projects
  ADD COLUMN descricao text CHECK (length(descricao) <= 4000),
  ADD COLUMN endereco text CHECK (length(endereco) <= 300),
  ADD COLUMN cidade text CHECK (length(cidade) <= 120),
  ADD COLUMN uf char(2) CHECK (uf ~ '^[A-Z]{2}$'),
  ADD COLUMN geom geometry(Point, 4326),
  ADD COLUMN altitude_m numeric(8, 2),
  ADD COLUMN rotacao_graus numeric(6, 2) NOT NULL DEFAULT 0 CHECK (rotacao_graus BETWEEN -360 AND 360),
  ADD COLUMN status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'lancamento', 'em_obra', 'pronto', 'arquivado')),
  ADD COLUMN atualizado_em timestamptz NOT NULL DEFAULT now();
CREATE INDEX projects_geom_idx ON projects USING gist (geom);
CREATE TRIGGER projects_atualizado BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

CREATE TABLE buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  project_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, nome),
  UNIQUE (id, tenant_id)
);

CREATE TABLE floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  numero integer NOT NULL CHECK (numero BETWEEN -10 AND 300),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 40),
  altura_m numeric(5, 2) NOT NULL DEFAULT 3 CHECK (altura_m > 0 AND altura_m <= 20),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (building_id, numero),
  UNIQUE (id, building_id),
  UNIQUE (id, tenant_id)
);

CREATE TABLE unit_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  project_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  area_m2 numeric(8, 2) NOT NULL CHECK (area_m2 > 0 AND area_m2 < 100000),
  quartos smallint NOT NULL DEFAULT 0 CHECK (quartos BETWEEN 0 AND 50),
  suites smallint NOT NULL DEFAULT 0 CHECK (suites BETWEEN 0 AND 50),
  vagas smallint NOT NULL DEFAULT 0 CHECK (vagas BETWEEN 0 AND 50),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (project_id, nome),
  UNIQUE (id, tenant_id)
);

CREATE TABLE units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  floor_id uuid NOT NULL,
  unit_type_id uuid,
  codigo text NOT NULL CHECK (codigo ~ '^[A-Za-z0-9-]{1,20}$'),
  status text NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel', 'reservado', 'vendido', 'bloqueado')),
  preco numeric(14, 2) CHECK (preco >= 0),
  mesh_node_id text CHECK (length(mesh_node_id) <= 200),
  crm_external_id text CHECK (length(crm_external_id) <= 200),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (floor_id, building_id) REFERENCES floors (id, building_id) ON DELETE CASCADE,
  FOREIGN KEY (unit_type_id, tenant_id) REFERENCES unit_types (id, tenant_id),
  UNIQUE (building_id, codigo),
  UNIQUE (id, tenant_id)
);
CREATE INDEX units_tenant_status_idx ON units (tenant_id, status);
CREATE INDEX units_floor_idx ON units (floor_id);
CREATE TRIGGER units_atualizado BEFORE UPDATE ON units FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

CREATE TABLE unit_status_history (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  unit_id uuid NOT NULL,
  de text NOT NULL,
  para text NOT NULL,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  motivo text CHECK (length(motivo) <= 500),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (unit_id, tenant_id) REFERENCES units (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX unit_status_history_unit_idx ON unit_status_history (unit_id, id DESC);

-- Outbox: o evento nasce na mesma transação da mudança; o Plano 06 publica e marca publicado_em.
CREATE TABLE eventos (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants (id) ON DELETE CASCADE,
  tipo text NOT NULL,
  entidade_id uuid,
  dados jsonb NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT now(),
  publicado_em timestamptz
);
CREATE INDEX eventos_pendentes_idx ON eventos (id) WHERE publicado_em IS NULL;

ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY buildings_por_empresa ON buildings USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY floors_por_empresa ON floors USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY unit_types_por_empresa ON unit_types USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY units_por_empresa ON units USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY historico_por_empresa ON unit_status_history USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY eventos_por_empresa ON eventos USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON buildings, floors, unit_types, units TO imersa_app;
GRANT SELECT, INSERT ON unit_status_history, eventos TO imersa_app;
GRANT USAGE ON SEQUENCE unit_status_history_id_seq, eventos_id_seq TO imersa_app;
