/** Sugestão automática de vínculo ambiente do BIM ↔ unidade do espelho de vendas (o resto é ajuste manual). */

export interface EspacoBim {
  guid: string;
  nome: string | null;
  nome_longo: string | null;
}
export interface Sugestao {
  unidadeId: string;
  espacoGuid: string;
  motivo: 'codigo' | 'numero';
}

const normal = (t: string | null | undefined) =>
  (t ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Número principal ("Apto 101" → "101", "B-012" → "12"); só quando houver exatamente um. */
function numero(t: string | null | undefined): string | null {
  const nums = (t ?? '').match(/\d+/g);
  return nums?.length === 1 ? nums[0]!.replace(/^0+(?=\d)/, '') : null;
}

/**
 * 1º código idêntico ao nome do ambiente (sem espaços, acentos e maiúsculas); 2º mesmo número único.
 * Cada ambiente vai para no máximo uma unidade; ambiguidade fica para o ajuste manual.
 */
export function sugerirVinculos(espacos: EspacoBim[], unidades: Array<{ id: string; codigo: string }>): Sugestao[] {
  const usados = new Set<string>();
  const sugestoes: Sugestao[] = [];
  for (const motivo of ['codigo', 'numero'] as const) {
    for (const u of unidades) {
      if (sugestoes.some((s) => s.unidadeId === u.id)) continue;
      const chave = motivo === 'codigo' ? normal : numero;
      const alvo = chave(u.codigo);
      if (!alvo) continue;
      const livres = espacos.filter((e) => !usados.has(e.guid) && (chave(e.nome) === alvo || chave(e.nome_longo) === alvo));
      if (livres.length === 1) {
        usados.add(livres[0]!.guid);
        sugestoes.push({ unidadeId: u.id, espacoGuid: livres[0]!.guid, motivo });
      }
    }
  }
  return sugestoes;
}
