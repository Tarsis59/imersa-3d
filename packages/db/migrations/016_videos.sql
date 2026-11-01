-- Estúdio de marketing (Plano 08): vídeo do prédio renderizado no Blender Cycles (GPU gratuita do Kaggle), fiel ao
-- projeto, nos formatos das redes (9:16, 1:1, 16:9), sempre com o selo "Imagem ilustrativa". MP4 + capa (assets).
ALTER TABLE assets DROP CONSTRAINT assets_tipo_check;
ALTER TABLE assets ADD CONSTRAINT assets_tipo_check CHECK (tipo IN ('modelo_3d', 'splat', 'ifc', 'planta', 'imagem', 'documento', 'captura', 'giro', 'video'));

CREATE TABLE videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  modelo_asset_id uuid NOT NULL,
  formato text NOT NULL CHECK (formato IN ('9:16', '1:1', '16:9')),
  -- quem fez o vídeo: o Blender (grátis, fiel ao projeto); outros provedores entram aqui sem mudar o resto
  provedor text NOT NULL DEFAULT 'blender' CHECK (provedor IN ('blender')),
  status text NOT NULL DEFAULT 'na_fila' CHECK (status IN ('na_fila', 'processando', 'pronto', 'erro')),
  mensagem text CHECK (length(mensagem) <= 1000),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 20),
  trabalho_em timestamptz,
  metricas jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metricas) = 'object'),
  video_asset_id uuid,
  capa_asset_id uuid,
  criado_por uuid DEFAULT app_user_id() REFERENCES users (id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (modelo_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (video_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE SET NULL (video_asset_id),
  FOREIGN KEY (capa_asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE SET NULL (capa_asset_id),
  UNIQUE (id, tenant_id)
);
CREATE INDEX videos_predio_idx ON videos (building_id, criado_em DESC);
CREATE INDEX videos_fila_idx ON videos (criado_em, id) WHERE status IN ('na_fila', 'processando');
-- um vídeo ativo por prédio e formato (pedir de novo não duplica o trabalho na GPU)
CREATE UNIQUE INDEX videos_ativo_uk ON videos (building_id, formato) WHERE status IN ('na_fila', 'processando');
CREATE TRIGGER videos_atualizado BEFORE UPDATE ON videos FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY videos_por_empresa ON videos USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON videos TO imersa_app;

CREATE FUNCTION pegar_proximo_video(prazo interval DEFAULT '4 hours')
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE videos v
     SET status = 'processando', trabalho_em = now(), tentativas = v.tentativas + 1
   WHERE v.id = (
     SELECT x.id FROM videos x
      WHERE x.status = 'na_fila' OR (x.status = 'processando' AND x.trabalho_em < now() - prazo)
      ORDER BY x.criado_em, x.id
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
  RETURNING v.id, v.tenant_id;
$$;
REVOKE ALL ON FUNCTION pegar_proximo_video(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pegar_proximo_video(interval) TO imersa_app;

CREATE FUNCTION ha_video_pendente(prazo interval DEFAULT '4 hours')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM videos x
     WHERE x.status = 'na_fila' OR (x.status = 'processando' AND x.trabalho_em < now() - prazo));
$$;
REVOKE ALL ON FUNCTION ha_video_pendente(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ha_video_pendente(interval) TO imersa_app;
