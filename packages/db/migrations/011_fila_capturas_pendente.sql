-- Checagem barata da fila de capturas (atravessa empresas, por isso SECURITY DEFINER do dono): o GitHub Actions
-- roda de hora em hora e só instala e processa quando há trabalho, para caber nos minutos grátis do repositório
-- privado. Não devolve nada além de sim/não. Mesmo critério de pegar_proxima_captura.
CREATE FUNCTION ha_captura_pendente(prazo interval DEFAULT '2 hours')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM capturas x
     WHERE x.status = 'na_fila' OR (x.status = 'processando' AND x.trabalho_em < now() - prazo));
$$;
REVOKE ALL ON FUNCTION ha_captura_pendente(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ha_captura_pendente(interval) TO imersa_app;
