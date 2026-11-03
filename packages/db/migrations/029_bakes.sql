-- Plano 12, etapa 12a, item 6: luz pré-calculada (bake de AO + luz difusa de dia e de noite) no Blender/Cycles,
-- na GPU gratuita do Kaggle (mesmo padrão dos giros e vídeos). O resultado é o próprio GLB do prédio "assado"
-- (occlusionTexture padrão do glTF, canal UV2, + extras com os índices das texturas de luz de dia e de noite,
-- que o viewer aplica e mistura pela hora do dia).
ALTER TABLE assets DROP CONSTRAINT assets_tipo_check;
ALTER TABLE assets ADD CONSTRAINT assets_tipo_check CHECK (tipo IN ('modelo_3d', 'splat', 'ifc', 'planta', 'imagem', 'documento', 'captura', 'giro', 'video', 'bake'));

CREATE TABLE bakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  -- o modelo assado (trocar o modelo do prédio deixa este bake desatualizado)
  modelo_asset_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila', 'processando', 'pronto', 'erro')),
  mensagem text CHECK (length(mensagem) <= 1000),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 20),
  trabalho_em timestamptz,
  metricas jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metricas) = 'object'),
  glb_asset_id uuid,
  criado_por uuid DEFAULT app_user_id() REFERENCES users (id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (modelo_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (glb_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE SET NULL (glb_asset_id),
  UNIQUE (id, tenant_id)
);
CREATE INDEX bakes_predio_idx ON bakes (building_id, criado_em DESC);
CREATE INDEX bakes_fila_idx ON bakes (criado_em, id) WHERE status IN ('na_fila', 'processando');
-- um bake ativo por prédio (pedir de novo não duplica o trabalho na GPU)
CREATE UNIQUE INDEX bakes_ativo_uk ON bakes (building_id) WHERE status IN ('na_fila', 'processando');
CREATE TRIGGER bakes_atualizado BEFORE UPDATE ON bakes FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

ALTER TABLE bakes ENABLE ROW LEVEL SECURITY;
CREATE POLICY bakes_por_empresa ON bakes USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON bakes TO imersa_app;

-- Fila do worker (atravessa empresas): o bake mais antigo na fila, ou um parado há mais que `prazo`.
CREATE FUNCTION pegar_proximo_bake(prazo interval DEFAULT '3 hours')
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE bakes b
     SET status = 'processando', trabalho_em = now(), tentativas = b.tentativas + 1
   WHERE b.id = (
     SELECT x.id FROM bakes x
      WHERE x.status = 'na_fila' OR (x.status = 'processando' AND x.trabalho_em < now() - prazo)
      ORDER BY x.criado_em, x.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
  RETURNING b.id, b.tenant_id;
$$;
REVOKE ALL ON FUNCTION pegar_proximo_bake(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pegar_proximo_bake(interval) TO imersa_app;

CREATE FUNCTION ha_bake_pendente(prazo interval DEFAULT '3 hours')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM bakes x
     WHERE x.status = 'na_fila' OR (x.status = 'processando' AND x.trabalho_em < now() - prazo));
$$;
REVOKE ALL ON FUNCTION ha_bake_pendente(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ha_bake_pendente(interval) TO imersa_app;
