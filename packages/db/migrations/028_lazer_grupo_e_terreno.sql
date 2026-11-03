-- Plano 12, etapa 12d: áreas de convívio por categoria (item 7) e terreno/infraestrutura do loteamento (item 8).

-- Menu de categorias da Vitrine (Lazer, Sociais, Gastronomia, Beach Sports, Pet), diferente da "categoria" já
-- existente (o tipo do espaço em si, ex.: piscina, academia): um grupo pode ter vários tipos (churrasqueira e
-- espaço gourmet caem em "gastronomia", por exemplo). Default "lazer" para quem já tinha itens cadastrados.
ALTER TABLE lazer ADD COLUMN grupo text NOT NULL DEFAULT 'lazer'
  CHECK (grupo IN ('lazer', 'sociais', 'gastronomia', 'beach_sports', 'pet'));
UPDATE lazer SET grupo = CASE categoria
  WHEN 'churrasqueira' THEN 'gastronomia'
  WHEN 'espaco_gourmet' THEN 'gastronomia'
  WHEN 'pet' THEN 'pet'
  WHEN 'salao_festas' THEN 'sociais'
  WHEN 'coworking' THEN 'sociais'
  WHEN 'quadra' THEN 'beach_sports'
  ELSE 'lazer'
END;

-- Terreno e infraestrutura do loteamento (ruas, meio-fio, calçadas, árvores da calçada e relevo das curvas de
-- nível), lidos do mesmo DXF dos lotes e guardados prontos (sem reprocessar o desenho a cada visita da Vitrine).
ALTER TABLE buildings ADD COLUMN terreno jsonb CHECK (terreno IS NULL OR jsonb_typeof(terreno) = 'object');
