-- Giro 360° fotorrealista (Plano 07c): o modelo 3D do prédio renderizado no Blender Cycles, na GPU gratuita do
-- Kaggle, em 72 quadros + máscaras das unidades. Fica num ZIP (asset 'giro', gerado pelo sistema).
ALTER TABLE assets DROP CONSTRAINT assets_tipo_check;
ALTER TABLE assets ADD CONSTRAINT assets_tipo_check CHECK (tipo IN ('modelo_3d', 'splat', 'ifc', 'planta', 'imagem', 'documento', 'captura', 'giro'));

CREATE TABLE giros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  -- o modelo renderizado (trocar o modelo do prédio deixa este giro desatualizado)
  modelo_asset_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila', 'processando', 'pronto', 'erro')),
  mensagem text CHECK (length(mensagem) <= 1000),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 20),
  trabalho_em timestamptz,
  -- unidades na ordem dos índices das máscaras (cor-ID = índice + 1), gravadas quando o giro fica pronto
  unidades jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(unidades) = 'array'),
  quadros integer CHECK (quadros BETWEEN 1 AND 720),
  metricas jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metricas) = 'object'),
  zip_asset_id uuid,
  criado_por uuid DEFAULT app_user_id() REFERENCES users (id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (modelo_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (zip_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE SET NULL (zip_asset_id),
  UNIQUE (id, tenant_id)
);
CREATE INDEX giros_predio_idx ON giros (building_id, criado_em DESC);
CREATE INDEX giros_fila_idx ON giros (criado_em, id) WHERE status IN ('na_fila', 'processando');
-- um giro ativo por prédio (pedir de novo não duplica o trabalho na GPU)
CREATE UNIQUE INDEX giros_ativo_uk ON giros (building_id) WHERE status IN ('na_fila', 'processando');
CREATE TRIGGER giros_atualizado BEFORE UPDATE ON giros FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

ALTER TABLE giros ENABLE ROW LEVEL SECURITY;
CREATE POLICY giros_por_empresa ON giros USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON giros TO imersa_app;

-- Fila do worker (atravessa empresas): o giro mais antigo na fila, ou um parado há mais que `prazo`.
CREATE FUNCTION pegar_proximo_giro(prazo interval DEFAULT '3 hours')
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE giros g
     SET status = 'processando', trabalho_em = now(), tentativas = g.tentativas + 1
   WHERE g.id = (
     SELECT x.id FROM giros x
      WHERE x.status = 'na_fila' OR (x.status = 'processando' AND x.trabalho_em < now() - prazo)
      ORDER BY x.criado_em, x.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
  RETURNING g.id, g.tenant_id;
$$;
REVOKE ALL ON FUNCTION pegar_proximo_giro(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pegar_proximo_giro(interval) TO imersa_app;

-- Checagem barata para o GitHub Actions (só sim/não), com o mesmo critério da fila.
CREATE FUNCTION ha_giro_pendente(prazo interval DEFAULT '3 hours')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM giros x
     WHERE x.status = 'na_fila' OR (x.status = 'processando' AND x.trabalho_em < now() - prazo));
$$;
REVOKE ALL ON FUNCTION ha_giro_pendente(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ha_giro_pendente(interval) TO imersa_app;
