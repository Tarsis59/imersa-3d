-- Plano 12b: WhatsApp do corretor no link do cliente. O card de cada unidade mostra "Falar com <corretor> sobre a 1201"
-- (e o QR em tela grande), com a unidade já citada na mensagem. Só dígitos, com o código do país (55...).
ALTER TABLE share_links ADD COLUMN whatsapp text CHECK (whatsapp ~ '^[0-9]{12,13}$');
