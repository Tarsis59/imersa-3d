-- Criação integrada (Plano 11a): a pessoa larga texto, arquivos e (se tiver) o endereço numa tela só, e a montagem
-- roda as etapas (ler o texto, achar o lugar, gerar o prédio e o lazer, buscar a cidade, mandar os arquivos para o
-- caminho certo). Cada etapa guarda o estado para a tela mostrar ao vivo e para retomar se algo cair.
CREATE TABLE montagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  project_id uuid NOT NULL,
  criada_por uuid DEFAULT app_user_id(),
  texto text CHECK (length(texto) <= 4000),
  -- o que a leitura entendeu, já conferido (e corrigido) pela pessoa
  descricao jsonb NOT NULL CHECK (jsonb_typeof(descricao) = 'object'),
  -- de onde veio a localização e o que a pessoa mandou para achá-la (GPS das fotos, CEP)
  pistas jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(pistas) = 'object'),
  -- planilha de unidades (CSV) quando veio uma
  planilha text CHECK (length(planilha) <= 3000000),
  -- arquivos da montagem com o papel que a pessoa confirmou: [{ id, papel }]
  arquivos jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(arquivos) = 'array'),
  estado text NOT NULL DEFAULT 'aguardando_arquivos' CHECK (estado IN ('aguardando_arquivos', 'montando', 'pronta', 'pronta_com_avisos', 'falhou')),
  -- [{ id, estado: pendente|rodando|feita|pulada|aviso|falhou, detalhe, ms }]
  etapas jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(etapas) = 'array'),
  iniciada_em timestamptz,
  concluida_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, tenant_id) REFERENCES projects (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (id, tenant_id)
);
CREATE INDEX montagens_projeto_idx ON montagens (tenant_id, project_id, criado_em DESC);
CREATE TRIGGER montagens_atualizado BEFORE UPDATE ON montagens FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

ALTER TABLE montagens ENABLE ROW LEVEL SECURITY;
CREATE POLICY montagens_por_empresa ON montagens USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON montagens TO imersa_app;

-- Endereço → coordenada (Nominatim tem limite de 1 pedido/s): o mesmo endereço não é consultado de novo.
CREATE TABLE geocodificacoes (
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  consulta text NOT NULL CHECK (length(consulta) BETWEEN 3 AND 400),
  resultados jsonb NOT NULL CHECK (jsonb_typeof(resultados) = 'array'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, consulta)
);
ALTER TABLE geocodificacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY geocodificacoes_por_empresa ON geocodificacoes USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON geocodificacoes TO imersa_app;
