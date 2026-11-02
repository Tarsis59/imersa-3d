-- Narração dos vídeos do estúdio (Plano 09b, item 22): voz em português (Kokoro-82M) e legenda, quando pedida.
-- {"voz": "pf_dora" | "pm_alex", "texto": "roteiro falado"}
ALTER TABLE videos ADD COLUMN narracao jsonb CHECK (
  narracao IS NULL OR (
    jsonb_typeof(narracao) = 'object' AND narracao->>'voz' IN ('pf_dora', 'pm_alex')
    AND length(narracao->>'texto') BETWEEN 10 AND 600
  )
);
