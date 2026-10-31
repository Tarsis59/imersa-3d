-- Supabase: rodar UMA vez, antes das migrations (Painel → SQL Editor, como postgres).
-- 1) Usuário da aplicação: sem superpoderes e SEM BYPASSRLS (o isolamento entre empresas depende disso).
--    Ele nasce sem login; quem administra a conta ativa com senha própria:
--      ALTER ROLE imersa_app WITH LOGIN PASSWORD '<senha forte>';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'imersa_app') THEN
    CREATE ROLE imersa_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
GRANT CONNECT ON DATABASE postgres TO imersa_app;
GRANT USAGE ON SCHEMA public TO imersa_app;

-- 2) O Imersa não usa a API automática do Supabase (Data API desligada no projeto). Mesmo assim, os papéis
--    públicos (anon, authenticated) ficam sem acesso a nada do schema public, agora e no futuro.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
