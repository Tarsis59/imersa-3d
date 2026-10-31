-- Configurador de acabamentos (Plano 07b): catálogo de materiais e de móveis por empresa e combinações salvas
-- (o que a cliente escolheu para cada superfície do prédio + móveis posicionados) com o orçamento.

-- Material PBR desenhado no navegador (padrão procedural + cor + rugosidade + metal): não depende de imagem,
-- carrega na hora e troca sem recarregar a cena. Preço por m² é opcional (sem preço, o orçamento mostra "sem preço").
CREATE TABLE materiais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  categoria text NOT NULL CHECK (categoria IN ('piso', 'parede', 'teto', 'telhado', 'esquadria', 'bancada', 'outro')),
  padrao text NOT NULL DEFAULT 'liso' CHECK (padrao IN ('liso', 'madeira', 'porcelanato', 'marmore', 'cimento', 'tijolo', 'pastilha')),
  cor text NOT NULL CHECK (cor ~ '^#[0-9a-f]{6}$'),
  -- segunda cor do padrão (rejunte, veio do mármore, nó da madeira); sem ela, um tom derivado da principal
  cor2 text CHECK (cor2 ~ '^#[0-9a-f]{6}$'),
  rugosidade numeric(3, 2) NOT NULL DEFAULT 0.8 CHECK (rugosidade BETWEEN 0 AND 1),
  metalico numeric(3, 2) NOT NULL DEFAULT 0 CHECK (metalico BETWEEN 0 AND 1),
  -- tamanho de uma repetição do padrão (peça de porcelanato, régua de madeira, tijolo), em metros
  escala_m numeric(5, 2) NOT NULL DEFAULT 0.6 CHECK (escala_m BETWEEN 0.05 AND 5),
  preco_m2 numeric(12, 2) CHECK (preco_m2 >= 0),
  fornecedor text CHECK (length(fornecedor) <= 120),
  codigo text CHECK (length(codigo) <= 60),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome),
  UNIQUE (id, tenant_id)
);
CREATE INDEX materiais_empresa_idx ON materiais (tenant_id, categoria, nome);
CREATE TRIGGER materiais_atualizado BEFORE UPDATE ON materiais FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

-- Móvel: um dos modelos padrão do Imersa (desenhados pelo próprio visualizador, licença própria) ou um GLB enviado
-- em "Arquivos". A licença e o autor de cada modelo são obrigatórios (só entra no catálogo o que pode ser usado).
CREATE TABLE moveis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants (id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  categoria text NOT NULL CHECK (categoria IN ('sala', 'quarto', 'cozinha', 'banheiro', 'escritorio', 'externo', 'decoracao')),
  modelo_padrao text CHECK (modelo_padrao ~ '^[a-z0-9-]{2,40}$'),
  asset_id uuid,
  preco numeric(12, 2) CHECK (preco >= 0),
  licenca text NOT NULL CHECK (length(licenca) BETWEEN 2 AND 120),
  autor text NOT NULL CHECK (length(autor) BETWEEN 2 AND 120),
  fonte_url text CHECK (fonte_url ~ '^https://' AND length(fonte_url) <= 500),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK ((modelo_padrao IS NULL) <> (asset_id IS NULL)),
  FOREIGN KEY (asset_id, tenant_id) REFERENCES assets (id, tenant_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, nome),
  UNIQUE (id, tenant_id)
);
CREATE INDEX moveis_empresa_idx ON moveis (tenant_id, categoria, nome);
CREATE TRIGGER moveis_atualizado BEFORE UPDATE ON moveis FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

-- Combinação salva: material escolhido por superfície (grupo do modelo) + móveis posicionados + orçamento calculado
-- pela API com os preços do catálogo no momento de salvar (as quantidades vêm do 3D).
CREATE TABLE configuracoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT app_tenant_id(),
  building_id uuid NOT NULL,
  unit_id uuid,
  nome text NOT NULL CHECK (length(nome) BETWEEN 2 AND 120),
  cliente text CHECK (length(cliente) <= 120),
  escolhas jsonb NOT NULL CHECK (jsonb_typeof(escolhas) = 'object'),
  orcamento jsonb NOT NULL CHECK (jsonb_typeof(orcamento) = 'object'),
  total numeric(14, 2) NOT NULL CHECK (total >= 0),
  criado_por uuid DEFAULT app_user_id() REFERENCES users (id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (building_id, tenant_id) REFERENCES buildings (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id, tenant_id) REFERENCES units (id, tenant_id) ON DELETE SET NULL (unit_id),
  UNIQUE (id, tenant_id)
);
CREATE INDEX configuracoes_predio_idx ON configuracoes (building_id, criado_em DESC);
CREATE TRIGGER configuracoes_atualizado BEFORE UPDATE ON configuracoes FOR EACH ROW EXECUTE FUNCTION tocar_atualizado_em();

ALTER TABLE materiais ENABLE ROW LEVEL SECURITY;
ALTER TABLE moveis ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY materiais_por_empresa ON materiais USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY moveis_por_empresa ON moveis USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY configuracoes_por_empresa ON configuracoes USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- catálogo: desativar em vez de apagar (combinações antigas continuam explicáveis); combinação pode ser apagada
GRANT SELECT, INSERT, UPDATE ON materiais, moveis TO imersa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON configuracoes TO imersa_app;
