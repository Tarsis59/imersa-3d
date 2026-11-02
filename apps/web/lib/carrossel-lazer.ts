import type { CategoriaLazer, ItemLazer } from './tipos';

/**
 * Carrossel das áreas comuns em 3D (Plano 12c, item 4): cada card já sabe o que abrir ao tocar, na ordem do tour
 * (a mesma do "Conheça o lazer", pelo campo `ordem` que a API já devolve ordenado):
 *  - o splat (Spark), se existir uma captura pronta com o mesmo nome do ponto;
 *  - senão, o giro 360° do prédio, se ele já tiver um (prerenderizado ou o leve, gerado na hora);
 *  - senão, voa a câmera até o ponto em 1ª pessoa.
 */
export type AcaoCarrossel = { tipo: 'splat'; interiorId: string } | { tipo: 'giro360' } | { tipo: 'voo' };

export interface CartaoCarrossel {
  id: string;
  nome: string;
  categoria: CategoriaLazer;
  /** Foto de capa da ficha (Plano 12b, item 6); `null` cai no ícone da categoria. */
  fotoId: string | null;
  acao: AcaoCarrossel;
}

/** Sem acento nem caixa: "Salão de Festas" e "salao de festas" são o mesmo nome. */
function normalizarNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function carrosselLazer(itens: readonly ItemLazer[], interiores: ReadonlyArray<{ id: string; nome: string }>, temGiro360: boolean): CartaoCarrossel[] {
  const splatPorNome = new Map(interiores.map((i) => [normalizarNome(i.nome), i.id]));
  return itens.map((it) => {
    const splatId = splatPorNome.get(normalizarNome(it.nome));
    const acao: AcaoCarrossel = splatId ? { tipo: 'splat', interiorId: splatId } : temGiro360 ? { tipo: 'giro360' } : { tipo: 'voo' };
    return { id: it.id, nome: it.nome, categoria: it.categoria, fotoId: it.fotos[0] ?? null, acao };
  });
}
