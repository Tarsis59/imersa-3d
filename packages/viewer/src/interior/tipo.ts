/** Valores iguais aos do enum `SplatFileType` do Spark (sem importar o Spark: ele só carrega quando o interior abre). */
export type TipoSplat = 'splat' | 'ply' | 'spz' | 'pcsogszip';

const POR_EXTENSAO: Record<string, TipoSplat> = { splat: 'splat', ply: 'ply', spz: 'spz', sog: 'pcsogszip' };

/** Pelo nome do arquivo: o link assinado não tem a extensão. */
export function tipoDoSplat(nome: string): TipoSplat | null {
  const m = /\.([a-z0-9]+)$/i.exec(nome.trim());
  return m ? (POR_EXTENSAO[m[1]!.toLowerCase()] ?? null) : null;
}
