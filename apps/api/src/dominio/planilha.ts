import { lerCsv } from './csv';
import { lerNumeroBr } from './numeros';
import { STATUS_UNIDADE, type StatusUnidade } from './status';

export const LIMITE_LINHAS = 5000;
const OBRIGATORIAS = ['predio', 'andar', 'codigo'] as const;

export interface LinhaPlanilha {
  linha: number;
  predio: string;
  andar: number;
  codigo: string;
  tipologia: string | null;
  areaM2: number | null;
  quartos: number | null;
  suites: number | null;
  vagas: number | null;
  preco: number | null;
  status: StatusUnidade | null;
}

export interface ErroPlanilha {
  linha: number;
  campo: string;
  mensagem: string;
}

const normalizar = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');

/** Valida a planilha inteira sem tocar no banco. Linha = número da linha no arquivo (cabeçalho = 1). */
export function validarPlanilha(texto: string): { linhas: LinhaPlanilha[]; erros: ErroPlanilha[] } {
  let tabela: string[][];
  try {
    tabela = lerCsv(texto);
  } catch (e) {
    return { linhas: [], erros: [{ linha: 0, campo: 'arquivo', mensagem: (e as Error).message }] };
  }
  if (tabela.length < 2) {
    return { linhas: [], erros: [{ linha: 0, campo: 'arquivo', mensagem: 'planilha vazia: precisa do cabeçalho e de pelo menos uma unidade' }] };
  }
  if (tabela.length - 1 > LIMITE_LINHAS) {
    return { linhas: [], erros: [{ linha: 0, campo: 'arquivo', mensagem: `máximo de ${LIMITE_LINHAS} unidades por arquivo` }] };
  }
  const cabecalho = tabela[0]!.map(normalizar);
  const faltando = OBRIGATORIAS.filter((c) => !cabecalho.includes(c));
  if (faltando.length) return { linhas: [], erros: faltando.map((campo) => ({ linha: 1, campo, mensagem: 'coluna obrigatória ausente' })) };

  const linhas: LinhaPlanilha[] = [];
  const erros: ErroPlanilha[] = [];
  const unidadesVistas = new Map<string, number>();
  const tipologiasVistas = new Map<string, { chave: string; linha: number }>();

  for (let r = 1; r < tabela.length; r++) {
    const numLinha = r + 1;
    const errosAntes = erros.length;
    const erro = (campo: string, mensagem: string) => erros.push({ linha: numLinha, campo, mensagem });
    const cel = (coluna: string) => {
      const i = cabecalho.indexOf(coluna);
      return i < 0 ? '' : (tabela[r]![i] ?? '').trim();
    };
    const numero = (coluna: string) => {
      const v = lerNumeroBr(cel(coluna));
      if (v === 'invalido') {
        erro(coluna, 'número inválido');
        return null;
      }
      return v;
    };
    const inteiro = (coluna: string) => {
      const v = numero(coluna);
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > 50)) {
        erro(coluna, 'deve ser número inteiro entre 0 e 50');
        return null;
      }
      return v;
    };

    const predio = cel('predio');
    if (!predio) erro('predio', 'obrigatório');
    else if (predio.length > 60) erro('predio', 'máximo de 60 caracteres');

    const andarTxt = cel('andar');
    let andar = 0;
    if (!/^-?\d+$/.test(andarTxt)) erro('andar', 'deve ser número inteiro');
    else {
      andar = Number(andarTxt);
      if (andar < -10 || andar > 300) erro('andar', 'deve estar entre -10 e 300');
    }

    const codigo = cel('codigo');
    if (!/^[A-Za-z0-9-]{1,20}$/.test(codigo)) erro('codigo', 'use até 20 letras, números ou hífen');

    const tipologia = cel('tipologia') || null;
    if (tipologia && tipologia.length > 60) erro('tipologia', 'máximo de 60 caracteres');
    const areaM2 = numero('area_m2');
    const quartos = inteiro('quartos');
    const suites = inteiro('suites');
    const vagas = inteiro('vagas');
    const preco = numero('preco');
    if (preco !== null && preco < 0) erro('preco', 'não pode ser negativo');

    const statusTxt = cel('status');
    let status: StatusUnidade | null = null;
    if (statusTxt) {
      const s = normalizar(statusTxt);
      if ((STATUS_UNIDADE as readonly string[]).includes(s)) status = s as StatusUnidade;
      else erro('status', 'use disponivel, reservado, vendido ou bloqueado');
    }

    if (!tipologia && [areaM2, quartos, suites, vagas].some((v) => v !== null)) {
      erro('tipologia', 'informe a tipologia para usar área, quartos, suítes ou vagas');
    }
    if (areaM2 !== null && areaM2 <= 0) erro('area_m2', 'deve ser maior que zero');

    if (erros.length > errosAntes) continue;

    const chaveUnidade = `${predio}|${codigo}`;
    const repetida = unidadesVistas.get(chaveUnidade);
    if (repetida) {
      erro('codigo', `unidade repetida (já aparece na linha ${repetida})`);
      continue;
    }
    unidadesVistas.set(chaveUnidade, numLinha);

    if (tipologia) {
      const chave = JSON.stringify([areaM2, quartos, suites, vagas]);
      const anterior = tipologiasVistas.get(tipologia);
      if (anterior && anterior.chave !== chave) {
        erro('tipologia', `tipologia "${tipologia}" com valores diferentes da linha ${anterior.linha}`);
        continue;
      }
      if (!anterior) tipologiasVistas.set(tipologia, { chave, linha: numLinha });
    }

    linhas.push({ linha: numLinha, predio, andar, codigo, tipologia, areaM2, quartos, suites, vagas, preco, status });
  }
  return { linhas, erros };
}
