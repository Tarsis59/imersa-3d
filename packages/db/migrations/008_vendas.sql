-- Vendas: link da consultora → portal público do comprador → eventos de visita → lead.

-- Link para o cliente: o banco guarda só o hash do token (quem vê o banco não consegue abrir o link).
CREATE TABLE share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  titulo text CHECK (length(titulo) <= 120),
  criado_por uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expira_em timestamptz NOT NULL,
  revogado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id)
);
CREATE INDEX share_links_predio_idx ON share_links (tenant_id, building_id, criado_em DESC);

-- Lead: só existe com consentimento explícito (LGPD, base legal "consentimento"), com prova do que foi aceito.
CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  link_id uuid NOT NULL,
  unit_id uuid,
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  telefone text CHECK (length(telefone) <= 30),
  email citext CHECK (length(email) <= 254),
  mensagem text CHECK (length(mensagem) <= 2000),
  consentimento boolean NOT NULL CHECK (consentimento),
  base_legal text NOT NULL DEFAULT 'consentimento' CHECK (base_legal = 'consentimento'),
  texto_consentimento text NOT NULL CHECK (length(texto_consentimento) BETWEEN 10 AND 2000),
  ip inet,
  navegador text CHECK (length(navegador) <= 400),
  status text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'em_contato', 'convertido', 'descartado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (telefone IS NOT NULL OR email IS NOT NULL),
  FOREIGN KEY (link_id, tenant_id) REFERENCES share_links (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id, tenant_id) REFERENCES units (id, tenant_id) ON DELETE SET NULL (unit_id)
);
CREATE INDEX leads_data_idx ON leads (tenant_id, criado_em DESC);
CREATE INDEX leads_link_idx ON leads (link_id);
CREATE TRIGGER leads_atualizado BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

-- Eventos de visita no portal. IP, navegador e sessão só até o prazo de retenção (anonimizar_eventos).
CREATE TABLE view_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  link_id uuid NOT NULL,
  sessao uuid,
  tipo text NOT NULL CHECK (tipo IN ('abriu', 'unidade', 'favorito', 'interior', 'tempo')),
  unit_id uuid,
  duracao_s integer CHECK (duracao_s BETWEEN 0 AND 86400),
  ip inet,
  navegador text CHECK (length(navegador) <= 400),
  anonimizado boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (link_id, tenant_id) REFERENCES share_links (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id, tenant_id) REFERENCES units (id, tenant_id) ON DELETE SET NULL (unit_id)
);
CREATE INDEX view_events_link_idx ON view_events (link_id, criado_em);
CREATE INDEX view_events_data_idx ON view_events (tenant_id, criado_em DESC);

ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE view_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY share_links_por_empresa ON share_links USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY leads_por_empresa ON leads USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY view_events_por_empresa ON view_events USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON share_links TO imersa_app;
GRANT SELECT, INSERT, UPDATE ON leads TO imersa_app;
GRANT SELECT, INSERT ON view_events TO imersa_app;

-- Portal público: do hash do token para a empresa/prédio/consultora (antes de saber a empresa, o RLS esconderia tudo).
-- Devolve também links vencidos/revogados, para a API responder 410 em vez de 404.
CREATE FUNCTION resolver_link(hash text)
RETURNS TABLE (link_id uuid, tenant_id uuid, building_id uuid, criado_por uuid, valido boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.tenant_id, l.building_id, l.criado_por, (l.revogado_em IS NULL AND l.expira_em > now())
    FROM share_links l
   WHERE l.token_hash = hash
$$;
REVOKE ALL ON FUNCTION resolver_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolver_link(text) TO imersa_app;

-- Retenção (LGPD): eventos mais velhos que `dias` perdem IP, navegador e sessão; os números agregados continuam.
-- Roda para todas as empresas (tarefa agendada), por isso SECURITY DEFINER.
CREATE FUNCTION anonimizar_eventos(dias integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF dias < 1 THEN RAISE EXCEPTION 'prazo de retenção inválido'; END IF;
  UPDATE view_events SET ip = NULL, navegador = NULL, sessao = NULL, anonimizado = true
   WHERE NOT anonimizado AND criado_em < now() - make_interval(days => dias);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION anonimizar_eventos(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION anonimizar_eventos(integer) TO imersa_app;
