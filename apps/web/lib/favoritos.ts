/** Favoritos da Vitrine 3D, por prédio, no navegador de quem está vendo. Nunca quebra a página. */
type Armazenamento = Pick<Storage, 'getItem' | 'setItem'>;

const chave = (predioId: string) => `imersa:favoritos:${predioId}`;

export function armazenamentoDoNavegador(): Armazenamento | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // modo privado ou dados do site bloqueados
  }
}

export function lerFavoritos(predioId: string, armazenamento: Armazenamento | null = armazenamentoDoNavegador()): Set<string> {
  try {
    const bruto = armazenamento?.getItem(chave(predioId));
    const lista: unknown = bruto ? JSON.parse(bruto) : [];
    return new Set(Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function salvarFavoritos(predioId: string, ids: ReadonlySet<string>, armazenamento: Armazenamento | null = armazenamentoDoNavegador()): void {
  try {
    armazenamento?.setItem(chave(predioId), JSON.stringify([...ids]));
  } catch {
    // sem espaço ou bloqueado: favoritos valem só nesta visita
  }
}

export function alternarFavorito(ids: ReadonlySet<string>, id: string): Set<string> {
  const novo = new Set(ids);
  if (!novo.delete(id)) novo.add(id);
  return novo;
}
