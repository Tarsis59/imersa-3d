-- Tempo real (status de unidade ao vivo) e integrações com CRMs (chaves de API + webhooks assinados).

-- Ao vivo: toda mudança de status de unidade avisa a API (LISTEN/NOTIFY do próprio Postgres, sem serviço extra).
CREATE FUNCTION avisar_status_unidade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('imersa_unidades', json_build_object('t', NEW.tenant_id, 'b', NEW.building_id, 'u', NEW.id, 's', NEW.status)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER units_status_ao_vivo AFTER UPDATE OF status ON units
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION avisar_status_unidade();

-- Chave de API da empresa (CRM lendo leads/unidades). O banco guarda só o hash; o prefixo identifica na tela.
CREATE TABLE chaves_api (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  prefixo text NOT NULL CHECK (length(prefixo) BETWEEN 8 AND 16),
  hash text NOT NULL UNIQUE,
  criado_por uuid REFERENCES users (id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_uso timestamptz,
  revogada_em timestamptz
);
CREATE INDEX chaves_api_tenant_idx ON chaves_api (tenant_id, criado_em DESC);

-- Webhook: a empresa recebe eventos no CRM. O segredo da assinatura fica cifrado (a API precisa dele para assinar).
CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants (id) ON DELETE CASCADE,
  url text NOT NULL CHECK (length(url) BETWEEN 10 AND 2000),
  segredo_cifrado text NOT NULL,
  eventos text[] NOT NULL CHECK (cardinality(eventos) > 0 AND eventos <@ ARRAY['lead.criado', 'unidade.status']::text[]),
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid REFERENCES users (id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id)
);
CREATE INDEX webhooks_tenant_idx ON webhooks (tenant_id);

-- Fila de entregas (com retentativa exponencial no worker).
CREATE TABLE webhook_entregas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  webhook_id uuid NOT NULL,
  evento text NOT NULL CHECK (evento IN ('lead.criado', 'unidade.status', 'teste')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'entregue', 'falhou')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  proxima_em timestamptz NOT NULL DEFAULT now(),
  ultimo_status integer,
  ultimo_erro text CHECK (length(ultimo_erro) <= 500),
  criado_em timestamptz NOT NULL DEFAULT now(),
  entregue_em timestamptz,
  FOREIGN KEY (webhook_id, tenant_id) REFERENCES webhooks (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX webhook_entregas_fila_idx ON webhook_entregas (proxima_em) WHERE status = 'pendente';
CREATE INDEX webhook_entregas_webhook_idx ON webhook_entregas (webhook_id, criado_em DESC);

ALTER TABLE chaves_api ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_entregas ENABLE ROW LEVEL SECURITY;
CREATE POLICY chaves_api_por_empresa ON chaves_api USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY webhooks_por_empresa ON webhooks USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY webhook_entregas_por_empresa ON webhook_entregas USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON chaves_api TO imersa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhooks TO imersa_app;
GRANT SELECT, INSERT, UPDATE ON webhook_entregas TO imersa_app;

-- Eventos → fila de entregas, no próprio banco: nenhuma rota (nem a importação de planilha) esquece de avisar.
CREATE FUNCTION enfileirar_webhooks(p_tenant uuid, p_evento text, p_payload jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO webhook_entregas (tenant_id, webhook_id, evento, payload)
  SELECT w.tenant_id, w.id, p_evento, p_payload FROM webhooks w
   WHERE w.tenant_id = p_tenant AND w.ativo AND p_evento = ANY (w.eventos)
$$;

CREATE FUNCTION webhook_lead_criado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enfileirar_webhooks(NEW.tenant_id, 'lead.criado', (
    SELECT jsonb_build_object(
      'id', NEW.id, 'nome', NEW.nome, 'telefone', NEW.telefone, 'email', NEW.email, 'mensagem', NEW.mensagem,
      'unidade', (SELECT codigo FROM units WHERE id = NEW.unit_id),
      'predio', b.nome, 'empreendimento', p.nome, 'consultora', u.nome, 'criadoEm', NEW.criado_em)
      FROM share_links l JOIN buildings b ON b.id = l.building_id JOIN projects p ON p.id = b.project_id JOIN users u ON u.id = l.criado_por
     WHERE l.id = NEW.link_id));
  RETURN NULL;
END $$;
CREATE TRIGGER leads_webhook AFTER INSERT ON leads FOR EACH ROW EXECUTE FUNCTION webhook_lead_criado();

CREATE FUNCTION webhook_unidade_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enfileirar_webhooks(NEW.tenant_id, 'unidade.status', (
    SELECT jsonb_build_object('id', NEW.id, 'codigo', NEW.codigo, 'predio', b.nome, 'empreendimento', p.nome, 'de', OLD.status, 'para', NEW.status, 'preco', NEW.preco)
      FROM buildings b JOIN projects p ON p.id = b.project_id WHERE b.id = NEW.building_id));
  RETURN NULL;
END $$;
CREATE TRIGGER units_webhook AFTER UPDATE OF status ON units
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION webhook_unidade_status();

-- Worker: pega entregas vencidas de todas as empresas sem repetir entre workers (SKIP LOCKED) e "reserva" por 5 min
-- (se o worker cair no meio, a entrega volta sozinha).
CREATE FUNCTION pegar_entregas_webhook(limite integer DEFAULT 20)
RETURNS TABLE (id uuid, tenant_id uuid, webhook_id uuid, url text, segredo_cifrado text, evento text, payload jsonb, tentativas integer, criado_em timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH alvo AS (
    SELECT e.id FROM webhook_entregas e
     WHERE e.status = 'pendente' AND e.proxima_em <= now()
     ORDER BY e.proxima_em
     LIMIT limite
       FOR UPDATE SKIP LOCKED
  )
  UPDATE webhook_entregas e SET tentativas = e.tentativas + 1, proxima_em = now() + interval '5 minutes'
    FROM alvo, webhooks w
   WHERE e.id = alvo.id AND w.id = e.webhook_id
  RETURNING e.id, e.tenant_id, e.webhook_id, w.url, w.segredo_cifrado, e.evento, e.payload, e.tentativas, e.criado_em
$$;
REVOKE ALL ON FUNCTION pegar_entregas_webhook(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pegar_entregas_webhook(integer) TO imersa_app;

-- API pública: chave → empresa (antes de saber a empresa o RLS esconderia a chave). Marca o último uso.
CREATE FUNCTION resolver_chave_api(p_hash text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE chaves_api SET ultimo_uso = now() WHERE hash = p_hash AND revogada_em IS NULL RETURNING tenant_id
$$;
REVOKE ALL ON FUNCTION resolver_chave_api(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolver_chave_api(text) TO imersa_app;
