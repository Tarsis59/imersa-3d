-- Capturas: fotos (ZIP) ou vídeo de um imóvel → 3D (Gaussian Splatting) pelo motor de reconstrução.
ALTER TABLE assets DROP CONSTRAINT assets_tipo_check;
ALTER TABLE assets ADD CONSTRAINT assets_tipo_check CHECK (tipo IN ('modelo_3d', 'splat', 'ifc', 'planta', 'imagem', 'documento', 'captura'));

CREATE TABLE capturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  project_id uuid NOT NULL,
  arquivo_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'aguardando_envio'
    CHECK (status IN ('aguardando_envio', 'na_fila', 'processando', 'revisao', 'publicado', 'erro', 'cancelado')),
  mensagem text CHECK (length(mensagem) <= 1000),
  detalhes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(detalhes) = 'array'),
  avisos jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(avisos) = 'array'),
  metricas jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metricas) = 'object'),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 20),
  -- última vez que o worker deu sinal de vida (captura parada há muito tempo volta para a fila)
  trabalho_em timestamptz,
  -- splat gerado, guardado no armazenamento até a publicação (só vira arquivo do projeto ao publicar)
  resultado_chave text CHECK (length(resultado_chave) <= 500),
  resultado_tamanho bigint CHECK (resultado_tamanho >= 0),
  splat_asset_id uuid,
  criado_por uuid DEFAULT app_user_id() REFERENCES users (id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (arquivo_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (splat_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE SET NULL (splat_asset_id),
  UNIQUE (id, tenant_id)
);
CREATE INDEX capturas_projeto_idx ON capturas (project_id, criado_em DESC);
CREATE INDEX capturas_fila_idx ON capturas (criado_em, id) WHERE status IN ('na_fila', 'processando');
CREATE TRIGGER capturas_atualizado BEFORE UPDATE ON capturas FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

ALTER TABLE capturas ENABLE ROW LEVEL SECURITY;
CREATE POLICY capturas_por_empresa ON capturas USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON capturas TO imersa_app;

-- Fila do worker (atravessa empresas, por isso SECURITY DEFINER do dono): pega a captura mais antiga na fila,
-- ou uma "processando" sem sinal de vida há mais que `prazo`, marca como processando e conta a tentativa.
-- FOR UPDATE SKIP LOCKED: dois workers nunca pegam a mesma. Devolve só id e empresa; o resto o worker lê
-- dentro do contexto da empresa (RLS).
CREATE FUNCTION pegar_proxima_captura(prazo interval DEFAULT '2 hours')
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE capturas c
     SET status = 'processando', trabalho_em = now(), tentativas = c.tentativas + 1
   WHERE c.id = (
     SELECT x.id FROM capturas x
      WHERE x.status = 'na_fila' OR (x.status = 'processando' AND x.trabalho_em < now() - prazo)
      ORDER BY x.criado_em, x.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
  RETURNING c.id, c.tenant_id;
$$;
REVOKE ALL ON FUNCTION pegar_proxima_captura(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pegar_proxima_captura(interval) TO imersa_app;
