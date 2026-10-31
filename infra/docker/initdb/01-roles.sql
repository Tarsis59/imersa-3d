CREATE ROLE imersa_app LOGIN PASSWORD 'imersa_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE imersa_test OWNER imersa_owner;
CREATE DATABASE imersa_test_api OWNER imersa_owner;
CREATE DATABASE imersa_e2e OWNER imersa_owner;
GRANT CONNECT ON DATABASE imersa, imersa_test, imersa_test_api, imersa_e2e TO imersa_app;
