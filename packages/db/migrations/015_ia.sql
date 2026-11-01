-- Assistente com IA (Plano 08): uso da API do Claude por empresa e por dia. Serve para medir o custo por conversa
-- e para o limite mensal de cada empresa (a conta da API é paga por token).
CREATE TABLE ia_uso (
  tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants (id) ON DELETE CASCADE,
  dia date NOT NULL DEFAULT current_date,
  conversas integer NOT NULL DEFAULT 0 CHECK (conversas >= 0),
  mensagens integer NOT NULL DEFAULT 0 CHECK (mensagens >= 0),
  chamadas integer NOT NULL DEFAULT 0 CHECK (chamadas >= 0),
  entrada bigint NOT NULL DEFAULT 0 CHECK (entrada >= 0),
  saida bigint NOT NULL DEFAULT 0 CHECK (saida >= 0),
  cache_leitura bigint NOT NULL DEFAULT 0 CHECK (cache_leitura >= 0),
  cache_escrita bigint NOT NULL DEFAULT 0 CHECK (cache_escrita >= 0),
  -- respostas em que a guarda tirou um preço que não veio das ferramentas (deve ficar em 0)
  bloqueios integer NOT NULL DEFAULT 0 CHECK (bloqueios >= 0),
  PRIMARY KEY (tenant_id, dia)
);

ALTER TABLE ia_uso ENABLE ROW LEVEL SECURITY;
CREATE POLICY ia_uso_por_empresa ON ia_uso USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON ia_uso TO imersa_app;
