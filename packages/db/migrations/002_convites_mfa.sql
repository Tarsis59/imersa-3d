-- O refresh guarda se a sessão passou por MFA, para a renovação manter o nível de segurança.
ALTER TABLE refresh_tokens ADD COLUMN mfa boolean NOT NULL DEFAULT false;

CREATE FUNCTION app_convite_hash() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.convite_hash', true), '') $$;

CREATE TABLE convites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants (id) ON DELETE CASCADE,
  email citext NOT NULL,
  papel text NOT NULL CHECK (papel IN ('admin', 'consultora', 'produtor', 'viewer')),
  token_hash text NOT NULL UNIQUE,
  criado_por uuid REFERENCES users (id) ON DELETE SET NULL,
  expira_em timestamptz NOT NULL,
  aceito_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX convites_tenant_idx ON convites (tenant_id);

ALTER TABLE convites ENABLE ROW LEVEL SECURITY;
CREATE POLICY convites_acesso ON convites
  USING (tenant_id = app_tenant_id() OR token_hash = app_convite_hash())
  WITH CHECK (tenant_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE ON convites TO imersa_app;
