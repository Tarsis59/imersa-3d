-- Missões e conquistas (Plano 11d, item 17): "conheça o lazer", "visite as tipologias", "entre num apartamento",
-- "veja o pôr do sol da unidade", "passeie a pé". Cada missão completa vira evento; o lead do link fica mais quente
-- (a temperatura vai junto para o CRM no webhook).
ALTER TABLE view_events ADD COLUMN missao text CHECK (missao IN ('lazer', 'tipologias', 'por_dentro', 'por_do_sol', 'a_pe'));
ALTER TABLE view_events DROP CONSTRAINT view_events_tipo_check;
ALTER TABLE view_events ADD CONSTRAINT view_events_tipo_check CHECK (tipo IN ('abriu', 'unidade', 'favorito', 'interior', 'tempo', 'tour_lazer', 'missao'));
ALTER TABLE view_events ADD CONSTRAINT view_events_missao_so_em_missao CHECK ((tipo = 'missao') = (missao IS NOT NULL));

-- Temperatura do interesse de quem visita pelo link: missões diferentes completas nos últimos 30 dias.
-- quente = 3 ou mais; morno = 1 ou 2; frio = nenhuma. Roda dentro da RLS de quem chama.
CREATE FUNCTION temperatura_do_link(p_link uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN n >= 3 THEN 'quente' WHEN n >= 1 THEN 'morno' ELSE 'frio' END
    FROM (SELECT count(DISTINCT missao) AS n FROM view_events
           WHERE link_id = p_link AND tipo = 'missao' AND criado_em > now() - interval '30 days') x
$$;
GRANT EXECUTE ON FUNCTION temperatura_do_link(uuid) TO imersa_app;

-- o CRM recebe o lead com as missões que a pessoa completou e a temperatura
CREATE OR REPLACE FUNCTION webhook_lead_criado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enfileirar_webhooks(NEW.tenant_id, 'lead.criado', (
    SELECT jsonb_build_object(
      'id', NEW.id, 'nome', NEW.nome, 'telefone', NEW.telefone, 'email', NEW.email, 'mensagem', NEW.mensagem,
      'unidade', (SELECT codigo FROM units WHERE id = NEW.unit_id),
      'predio', b.nome, 'empreendimento', p.nome, 'consultora', u.nome, 'criadoEm', NEW.criado_em,
      'missoes', coalesce((SELECT jsonb_agg(DISTINCT e.missao ORDER BY e.missao) FROM view_events e
                            WHERE e.link_id = NEW.link_id AND e.tipo = 'missao' AND e.criado_em > now() - interval '30 days'), '[]'::jsonb),
      'temperatura', temperatura_do_link(NEW.link_id))
      FROM share_links l JOIN buildings b ON b.id = l.building_id JOIN projects p ON p.id = b.project_id JOIN users u ON u.id = l.criado_por
     WHERE l.id = NEW.link_id));
  RETURN NULL;
END $$;
