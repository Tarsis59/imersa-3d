import type Anthropic from '@anthropic-ai/sdk';
import type pg from 'pg';
import { z } from 'zod';

/** O que a IA pode ver: um prédio (o do link do cliente ou o aberto no painel). Vem do servidor, nunca da IA. */
export interface ContextoIA {
  predioId: string;
  projetoId: string;
}

/** O que a resposta pede para a tela fazer (a IA não mexe em nada sozinha: só sugere à tela). */
export type AcaoTela = { tipo: 'mostrar'; unidades: string[]; focar: string | null } | { tipo: 'contato'; motivo: 'contato' | 'visita'; unidade: string | null };

export interface ResultadoFerramenta {
  /** Vai para a IA (JSON). */
  conteudo: unknown;
  acao?: AcaoTela;
  /** Preços que a IA recebeu de verdade: só estes podem aparecer na resposta (guarda de preço). */
  precos: number[];
}

const METROS_POR_MINUTO = 80;
const STATUS_VISIVEIS = ['disponivel', 'reservado', 'vendido'] as const;
const CATEGORIAS = ['escola', 'saude', 'mercado', 'farmacia', 'transporte', 'parque', 'outro'] as const;
const inteiroOuNulo = { type: ['integer', 'null'] } as const;
const numeroOuNulo = { type: ['number', 'null'] } as const;

/**
 * Ferramentas (schema estrito: a entrada sempre bate com o schema). Ordem e texto fixos: entram no prefixo em cache.
 */
export const FERRAMENTAS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'dados_empreendimento',
    description:
      'Dados gerais do empreendimento e do prédio: nome, descrição, endereço, cidade, tipologias (área, quartos, suítes, vagas), quantas unidades há em cada situação e a faixa de preço das unidades disponíveis. Use antes de falar do empreendimento em geral.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'buscar_unidades',
    description:
      'Busca unidades do prédio com filtros (todos opcionais: use null para não filtrar). Devolve código, andar, situação, preço (só das disponíveis), área, quartos, suítes, vagas e tipologia, até 30 unidades, e o total encontrado. Toda resposta sobre preço, situação ou disponibilidade tem de vir desta ferramenta ou de detalhar_unidade.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        quartos_min: inteiroOuNulo,
        quartos_max: inteiroOuNulo,
        area_min_m2: numeroOuNulo,
        area_max_m2: numeroOuNulo,
        preco_max: { ...numeroOuNulo, description: 'em reais' },
        andar_min: inteiroOuNulo,
        andar_max: inteiroOuNulo,
        situacao: { type: 'string', enum: ['disponivel', 'reservado', 'vendido', 'qualquer'], description: 'padrão: disponivel' },
      },
      required: ['quartos_min', 'quartos_max', 'area_min_m2', 'area_max_m2', 'preco_max', 'andar_min', 'andar_max', 'situacao'],
      additionalProperties: false,
    },
  },
  {
    name: 'detalhar_unidade',
    description: 'Todos os dados de uma unidade pelo código (ex.: "101", "A-1203").',
    strict: true,
    input_schema: { type: 'object', properties: { codigo: { type: 'string' } }, required: ['codigo'], additionalProperties: false },
  },
  {
    name: 'pontos_proximos',
    description: 'Escolas, saúde, mercados, farmácias, transporte e parques perto do empreendimento, com a distância e o tempo a pé. categoria null = todas.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { categoria: { type: ['string', 'null'], enum: [...CATEGORIAS, null] } },
      required: ['categoria'],
      additionalProperties: false,
    },
  },
  {
    name: 'mostrar_no_3d',
    description:
      'Destaca unidades no 3D que o cliente está vendo (as outras ficam apagadas) e, se pedido, leva a câmera até uma delas. Use sempre que falar de unidades específicas. codigos vazio = volta a mostrar todas.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { codigos: { type: 'array', items: { type: 'string' } }, focar: { type: ['string', 'null'], description: 'código da unidade para a câmera voar até ela' } },
      required: ['codigos', 'focar'],
      additionalProperties: false,
    },
  },
  {
    name: 'pedir_contato',
    description:
      'Abre na tela o formulário de contato da consultora (o cliente preenche nome e telefone e autoriza o contato). Use quando o cliente quiser falar com alguém, negociar, saber condições de pagamento ou agendar uma visita. Nunca peça nem anote dados pessoais na conversa.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', enum: ['contato', 'visita'] }, codigo: { type: ['string', 'null'], description: 'unidade de interesse, se houver' } },
      required: ['motivo', 'codigo'],
      additionalProperties: false,
    },
  },
];

const Busca = z.object({
  quartos_min: z.number().int().min(0).max(50).nullable(),
  quartos_max: z.number().int().min(0).max(50).nullable(),
  area_min_m2: z.number().min(0).nullable(),
  area_max_m2: z.number().min(0).nullable(),
  preco_max: z.number().min(0).nullable(),
  andar_min: z.number().int().nullable(),
  andar_max: z.number().int().nullable(),
  situacao: z.enum(['disponivel', 'reservado', 'vendido', 'qualquer']),
});
const Codigo = z.object({ codigo: z.string().trim().min(1).max(20) });
const Pontos = z.object({ categoria: z.enum(CATEGORIAS).nullable() });
const Mostrar = z.object({ codigos: z.array(z.string().trim().min(1).max(20)).max(200), focar: z.string().trim().min(1).max(20).nullable() });
const Contato = z.object({ motivo: z.enum(['contato', 'visita']), codigo: z.string().trim().min(1).max(20).nullable() });

interface LinhaUnidade {
  id: string;
  codigo: string;
  andar: number;
  andar_nome: string;
  status: string;
  preco: number | null;
  area_m2: number | null;
  quartos: number | null;
  suites: number | null;
  vagas: number | null;
  tipologia: string | null;
}

const SELECT_UNIDADE = `SELECT u.id, u.codigo, f.numero AS andar, f.nome AS andar_nome, u.status, u.preco::float8 AS preco, t.area_m2::float8 AS area_m2,
                               t.quartos, t.suites, t.vagas, t.nome AS tipologia
                          FROM units u JOIN floors f ON f.id = u.floor_id LEFT JOIN unit_types t ON t.id = u.unit_type_id
                         WHERE u.building_id = $1 AND u.status <> 'bloqueado'`;

/** Preço só das disponíveis: reservada ou vendida não tem preço para oferecer. */
function paraIA(u: LinhaUnidade) {
  return {
    codigo: u.codigo,
    andar: u.andar,
    andarNome: u.andar_nome,
    situacao: u.status,
    preco: u.status === 'disponivel' ? u.preco : null,
    areaM2: u.area_m2,
    quartos: u.quartos,
    suites: u.suites,
    vagas: u.vagas,
    tipologia: u.tipologia,
  };
}
const precosDe = (us: LinhaUnidade[]) => us.filter((u) => u.status === 'disponivel' && u.preco !== null).map((u) => u.preco!);

async function porCodigos(c: pg.PoolClient, ctx: ContextoIA, codigos: string[]): Promise<Map<string, LinhaUnidade>> {
  if (!codigos.length) return new Map();
  const r = await c.query<LinhaUnidade>(`${SELECT_UNIDADE} AND lower(u.codigo) = ANY($2::text[])`, [ctx.predioId, codigos.map((x) => x.toLowerCase())]);
  return new Map(r.rows.map((u) => [u.codigo.toLowerCase(), u]));
}

/** Roda uma ferramenta dentro do contexto da empresa (RLS) e só no prédio do contexto. Entrada inválida vira erro para a IA. */
export async function executarFerramenta(c: pg.PoolClient, ctx: ContextoIA, nome: string, entrada: unknown): Promise<ResultadoFerramenta> {
  switch (nome) {
    case 'dados_empreendimento': {
      const p = (
        await c.query<{ nome: string; descricao: string | null; endereco: string | null; cidade: string | null; uf: string | null; predio: string }>(
          'SELECT p.nome, p.descricao, p.endereco, p.cidade, p.uf, b.nome AS predio FROM projects p JOIN buildings b ON b.project_id = p.id WHERE b.id = $1',
          [ctx.predioId],
        )
      ).rows[0]!;
      const contagem = (await c.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM units WHERE building_id = $1 AND status <> 'bloqueado' GROUP BY status", [ctx.predioId])).rows;
      const faixa = (
        await c.query<{ min: number | null; max: number | null }>(
          "SELECT min(preco)::float8 AS min, max(preco)::float8 AS max FROM units WHERE building_id = $1 AND status = 'disponivel' AND preco IS NOT NULL",
          [ctx.predioId],
        )
      ).rows[0]!;
      const tipologias = (
        await c.query(
          `SELECT DISTINCT t.nome, t.area_m2::float8 AS "areaM2", t.quartos, t.suites, t.vagas
             FROM unit_types t JOIN units u ON u.unit_type_id = t.id WHERE u.building_id = $1 ORDER BY 2`,
          [ctx.predioId],
        )
      ).rows;
      return {
        conteudo: {
          empreendimento: p.nome,
          predio: p.predio,
          descricao: p.descricao,
          endereco: p.endereco,
          cidade: p.cidade ? `${p.cidade}${p.uf ? `/${p.uf}` : ''}` : null,
          unidadesPorSituacao: Object.fromEntries(STATUS_VISIVEIS.map((s) => [s, contagem.find((x) => x.status === s)?.n ?? 0])),
          faixaDePrecoDisponiveis: faixa.min === null ? null : { de: faixa.min, ate: faixa.max },
          tipologias,
        },
        precos: faixa.min === null ? [] : [faixa.min, faixa.max!],
      };
    }
    case 'buscar_unidades': {
      const f = Busca.parse(entrada);
      const cond: string[] = [];
      const args: unknown[] = [ctx.predioId];
      const add = (sql: string, v: unknown) => {
        args.push(v);
        cond.push(sql.replace('?', `$${args.length}`));
      };
      if (f.situacao !== 'qualquer') add('u.status = ?', f.situacao);
      if (f.quartos_min !== null) add('t.quartos >= ?', f.quartos_min);
      if (f.quartos_max !== null) add('t.quartos <= ?', f.quartos_max);
      if (f.area_min_m2 !== null) add('t.area_m2 >= ?', f.area_min_m2);
      if (f.area_max_m2 !== null) add('t.area_m2 <= ?', f.area_max_m2);
      // preço máximo só faz sentido para quem tem preço à venda
      if (f.preco_max !== null) add("u.status = 'disponivel' AND u.preco <= ?", f.preco_max);
      if (f.andar_min !== null) add('f.numero >= ?', f.andar_min);
      if (f.andar_max !== null) add('f.numero <= ?', f.andar_max);
      const r = await c.query<LinhaUnidade>(`${SELECT_UNIDADE}${cond.map((x) => ` AND ${x}`).join('')} ORDER BY f.numero, u.codigo`, args);
      const lista = r.rows.slice(0, 30);
      return { conteudo: { total: r.rows.length, mostrando: lista.length, unidades: lista.map(paraIA) }, precos: precosDe(lista) };
    }
    case 'detalhar_unidade': {
      const { codigo } = Codigo.parse(entrada);
      const u = (await porCodigos(c, ctx, [codigo])).get(codigo.toLowerCase());
      if (!u) return { conteudo: { erro: `Não existe unidade ${codigo} à venda neste prédio.` }, precos: [] };
      return { conteudo: paraIA(u), precos: precosDe([u]) };
    }
    case 'pontos_proximos': {
      const { categoria } = Pontos.parse(entrada);
      const r = await c.query<{ categoria: string; nome: string; distanciaM: number }>(
        `SELECT p.categoria, p.nome, round(ST_Distance(p.geom::geography, pr.geom::geography))::int AS "distanciaM"
           FROM pois p JOIN projects pr ON pr.id = p.project_id
          WHERE p.project_id = $1 AND pr.geom IS NOT NULL AND ($2::text IS NULL OR p.categoria = $2) ORDER BY 3, 2 LIMIT 15`,
        [ctx.projetoId, categoria],
      );
      return { conteudo: { pontos: r.rows.map((p) => ({ ...p, minutosAPe: Math.max(1, Math.ceil(p.distanciaM / METROS_POR_MINUTO)) })) }, precos: [] };
    }
    case 'mostrar_no_3d': {
      const { codigos, focar } = Mostrar.parse(entrada);
      const achadas = await porCodigos(c, ctx, [...codigos, ...(focar ? [focar] : [])]);
      const ids = codigos.map((x) => achadas.get(x.toLowerCase())?.id).filter((x): x is string => !!x);
      const foco = focar ? (achadas.get(focar.toLowerCase())?.id ?? null) : null;
      const faltando = [...codigos, ...(focar ? [focar] : [])].filter((x) => !achadas.has(x.toLowerCase()));
      return {
        conteudo: { mostrando: ids.length, focando: foco !== null, ...(faltando.length ? { naoEncontradas: faltando } : {}) },
        acao: { tipo: 'mostrar', unidades: ids, focar: foco },
        precos: [],
      };
    }
    case 'pedir_contato': {
      const { motivo, codigo } = Contato.parse(entrada);
      const u = codigo ? (await porCodigos(c, ctx, [codigo])).get(codigo.toLowerCase()) : undefined;
      return { conteudo: { formularioAberto: true }, acao: { tipo: 'contato', motivo, unidade: u?.id ?? null }, precos: [] };
    }
    default:
      return { conteudo: { erro: `Ferramenta desconhecida: ${nome}` }, precos: [] };
  }
}
