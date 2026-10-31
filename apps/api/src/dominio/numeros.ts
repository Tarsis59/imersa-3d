/**
 * Lê números como as pessoas digitam no Brasil: "650.000,00", "72,5", "R$ 1.200", "650000".
 * Ambíguo ou estrangeiro ("1,234.56") é recusado, para nunca gravar valor errado em silêncio.
 */
export function lerNumeroBr(bruto: string): number | null | 'invalido' {
  const s = bruto.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (s === '') return null;
  let normal: string;
  if (s.includes(',')) {
    if ((s.match(/,/g) ?? []).length > 1 || s.lastIndexOf('.') > s.lastIndexOf(',')) return 'invalido';
    if (s.includes('.') && !/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) return 'invalido';
    normal = s.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    normal = s.replace(/\./g, '');
  } else {
    normal = s;
  }
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return 'invalido';
  return Number(normal);
}
