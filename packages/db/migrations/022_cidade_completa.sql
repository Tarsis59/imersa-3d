-- Cidade completa em volta (Plano 11b): ruas, calçadas, áreas verdes e água do OSM e o relevo (Terrain Tiles da AWS)
-- ficam no mesmo cache do entorno. null = cache de antes desta mudança (a próxima visita completa).
ALTER TABLE entornos
  ADD COLUMN vias jsonb CHECK (vias IS NULL OR jsonb_typeof(vias) = 'array'),
  ADD COLUMN areas jsonb CHECK (areas IS NULL OR jsonb_typeof(areas) = 'array'),
  ADD COLUMN relevo jsonb CHECK (relevo IS NULL OR jsonb_typeof(relevo) = 'object');

-- Tempo a pé pelo desenho das ruas (não em linha reta) até cada ponto próximo; null = sem ruas para calcular.
ALTER TABLE pois ADD COLUMN caminho_m integer CHECK (caminho_m IS NULL OR caminho_m BETWEEN 0 AND 100000);
