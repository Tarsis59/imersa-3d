-- Planta baixa (PDF, imagem ou DXF) → paredes, portas, janelas e cômodos detectados → editor → 3D (Plano 07c).
CREATE TABLE plantas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  project_id uuid NOT NULL,
  arquivo_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila', 'processando', 'pronto', 'erro')),
  mensagem text CHECK (length(mensagem) <= 1000),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 20),
  trabalho_em timestamptz,
  -- a planta como imagem (o editor desenha por cima dela) e o que o detector achou, em pixels dessa imagem
  imagem_asset_id uuid,
  deteccao jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(deteccao) = 'object'),
  -- o que a pessoa conferiu no editor (escala, paredes, aberturas, alturas); vazio = ainda não editou
  edicao jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(edicao) = 'object'),
  -- 3D gerado a partir da edição
  glb_asset_id uuid,
  criado_por uuid DEFAULT app_user_id() REFERENCES users (id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (arquivo_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (imagem_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE SET NULL (imagem_asset_id),
  FOREIGN KEY (glb_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE SET NULL (glb_asset_id),
  UNIQUE (id, tenant_id)
);
CREATE INDEX plantas_projeto_idx ON plantas (project_id, criado_em DESC);
CREATE INDEX plantas_fila_idx ON plantas (criado_em, id) WHERE status IN ('na_fila', 'processando');
-- uma leitura ativa por arquivo (pedir de novo não duplica o trabalho)
CREATE UNIQUE INDEX plantas_ativa_uk ON plantas (arquivo_id) WHERE status IN ('na_fila', 'processando');
CREATE TRIGGER plantas_atualizado BEFORE UPDATE ON plantas FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

ALTER TABLE plantas ENABLE ROW LEVEL SECURITY;
CREATE POLICY plantas_por_empresa ON plantas USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON plantas TO imersa_app;

-- Fila do worker (atravessa empresas): a planta mais antiga na fila, ou uma parada há mais que `prazo`.
CREATE FUNCTION pegar_proxima_planta(prazo interval DEFAULT '15 minutes')
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE plantas p
     SET status = 'processando', trabalho_em = now(), tentativas = p.tentativas + 1
   WHERE p.id = (
     SELECT x.id FROM plantas x
      WHERE x.status = 'na_fila' OR (x.status = 'processando' AND x.trabalho_em < now() - prazo)
      ORDER BY x.criado_em, x.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
  RETURNING p.id, p.tenant_id;
$$;
REVOKE ALL ON FUNCTION pegar_proxima_planta(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pegar_proxima_planta(interval) TO imersa_app;
