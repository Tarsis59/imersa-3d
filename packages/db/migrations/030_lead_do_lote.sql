-- Plano 12e: o pedido de contato feito a partir de um lote do loteamento guarda qual lote, do mesmo jeito que já
-- guarda a unidade (migration 008/024). "lote X da quadra Y" vai para o painel, o webhook e a API /v1.
ALTER TABLE leads ADD COLUMN lote_id uuid;
ALTER TABLE leads ADD FOREIGN KEY (lote_id, tenant_id) REFERENCES lotes (id, tenant_id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION webhook_lead_criado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enfileirar_webhooks(NEW.tenant_id, 'lead.criado', (
    SELECT jsonb_build_object(
      'id', NEW.id, 'nome', NEW.nome, 'telefone', NEW.telefone, 'email', NEW.email, 'mensagem', NEW.mensagem,
      'unidade', (SELECT codigo FROM units WHERE id = NEW.unit_id),
      'lote', (SELECT 'lote ' || numero || ' da quadra ' || quadra FROM lotes WHERE id = NEW.lote_id),
      'predio', b.nome, 'empreendimento', p.nome, 'consultora', u.nome, 'criadoEm', NEW.criado_em,
      'missoes', coalesce((SELECT jsonb_agg(DISTINCT e.missao ORDER BY e.missao) FROM view_events e
                            WHERE e.link_id = NEW.link_id AND e.tipo = 'missao' AND e.criado_em > now() - interval '30 days'), '[]'::jsonb),
      'temperatura', temperatura_do_link(NEW.link_id))
      FROM share_links l JOIN buildings b ON b.id = l.building_id JOIN projects p ON p.id = b.project_id JOIN users u ON u.id = l.criado_por
     WHERE l.id = NEW.link_id));
  RETURN NULL;
END $$;
