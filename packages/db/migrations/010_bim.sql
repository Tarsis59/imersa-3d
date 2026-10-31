-- BIM: arquivo IFC → modelo 3D (GLB otimizado) + pavimentos, ambientes e áreas, com vínculo ambiente ↔ unidade.
CREATE TABLE conversoes_bim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  project_id uuid NOT NULL,
  arquivo_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila', 'processando', 'pronto', 'erro')),
  mensagem text CHECK (length(mensagem) <= 1000),
  -- pavimentos, ambientes (guid, nome, área), portas e janelas
  metadados jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadados) = 'object'),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 20),
  trabalho_em timestamptz,
  glb_asset_id uuid,
  criado_por uuid DEFAULT app_user_id() REFERENCES users (id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (arquivo_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (glb_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE SET NULL (glb_asset_id),
  UNIQUE (id, tenant_id)
);
CREATE INDEX conversoes_bim_projeto_idx ON conversoes_bim (project_id, criado_em DESC);
CREATE INDEX conversoes_bim_fila_idx ON conversoes_bim (criado_em, id) WHERE status IN ('na_fila', 'processando');
-- um IFC só tem uma conversão ativa por vez (enviar de novo o mesmo arquivo não duplica o trabalho)
CREATE UNIQUE INDEX conversoes_bim_ativa_uk ON conversoes_bim (arquivo_id) WHERE status IN ('na_fila', 'processando');
CREATE TRIGGER conversoes_bim_atualizado BEFORE UPDATE ON conversoes_bim FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

ALTER TABLE conversoes_bim ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversoes_bim_por_empresa ON conversoes_bim USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON conversoes_bim TO imersa_app;

-- Fila do worker (atravessa empresas): a conversão mais antiga na fila, ou uma parada há mais que `prazo`.
CREATE FUNCTION pegar_proxima_conversao(prazo interval DEFAULT '30 minutes')
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE conversoes_bim c
     SET status = 'processando', trabalho_em = now(), tentativas = c.tentativas + 1
   WHERE c.id = (
     SELECT x.id FROM conversoes_bim x
      WHERE x.status = 'na_fila' OR (x.status = 'processando' AND x.trabalho_em < now() - prazo)
      ORDER BY x.criado_em, x.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
  RETURNING c.id, c.tenant_id;
$$;
REVOKE ALL ON FUNCTION pegar_proxima_conversao(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pegar_proxima_conversao(interval) TO imersa_app;
