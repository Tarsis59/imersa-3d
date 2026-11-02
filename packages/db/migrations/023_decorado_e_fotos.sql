-- Apartamento decorado gerado na hora (Plano 11c, item 12): o estilo escolhido para o empreendimento (móveis, piso e
-- paredes da unidade do prédio desenhado). Planta e modelo de verdade continuam mandando onde existem.
ALTER TABLE projects ADD COLUMN estilo_decorado text NOT NULL DEFAULT 'moderno' CHECK (estilo_decorado IN ('moderno', 'classico', 'jovem'));

-- Fotos no lugar certo (Plano 11c, item 14): o papel que a pessoa confirmou na criação e, para foto com GPS, onde foi
-- tirada e para onde a câmera olhava (rumo da bússola, graus a partir do norte). O 3D põe um quadro ali.
ALTER TABLE assets
  ADD COLUMN papel text CHECK (papel IN ('foto', 'render', 'fachada', 'planta', 'documento', 'ifc', 'modelo', 'splat', 'captura')),
  ADD COLUMN lat double precision CHECK (lat BETWEEN -90 AND 90),
  ADD COLUMN lon double precision CHECK (lon BETWEEN -180 AND 180),
  ADD COLUMN rumo real CHECK (rumo >= 0 AND rumo < 360),
  ADD CONSTRAINT assets_lat_lon_juntos CHECK ((lat IS NULL) = (lon IS NULL));
