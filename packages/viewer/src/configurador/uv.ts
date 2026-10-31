/**
 * Coordenadas de textura por projeção em caixa, em metros: cada triângulo usa o plano em que ele mais "aparece"
 * (o eixo dominante da normal). O IFC convertido não traz UV; assim uma textura com `repeat = 1 / escala` cobre
 * paredes, pisos e telhados com o tamanho real da peça (porcelanato de 60 cm fica com 60 cm em qualquer parede).
 * Devolve uma geometria NÃO indexada (cada triângulo com os próprios vértices), para os cantos não borrarem.
 *
 * `matriz` (matrixWorld, coluna maior): o GLB otimizado guarda posições quantizadas, com a escala no nó. As
 * posições e normais devolvidas continuam no espaço da malha; a UV e a escolha do plano usam o mundo (metros).
 */
export function uvCaixa(
  posicoes: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  matriz?: ArrayLike<number>,
): { posicoes: Float32Array; uv: Float32Array; normais: Float32Array } {
  const total = indices ? indices.length : posicoes.length / 3;
  const triangulos = Math.floor(total / 3);
  const pos = new Float32Array(triangulos * 9);
  const uv = new Float32Array(triangulos * 6);
  const nor = new Float32Array(triangulos * 9);
  const v = (k: number) => (indices ? indices[k]! : k);
  const m = matriz;
  const local = (i: number): [number, number, number] => [posicoes[i * 3]!, posicoes[i * 3 + 1]!, posicoes[i * 3 + 2]!];
  const mundo = (p: [number, number, number]): [number, number, number] =>
    m
      ? [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!, m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!, m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!]
      : p;
  const normal = (a: number[], b: number[], c: number[]): [number, number, number] => {
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const wx = c[0]! - a[0]!, wy = c[1]! - a[1]!, wz = c[2]! - a[2]!;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  };
  for (let t = 0; t < triangulos; t++) {
    const l: [number, number, number][] = [local(v(t * 3)), local(v(t * 3 + 1)), local(v(t * 3 + 2))];
    const w = l.map(mundo);
    const nl = normal(l[0]!, l[1]!, l[2]!);
    const [nx, ny, nz] = normal(w[0]!, w[1]!, w[2]!);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (let k = 0; k < 3; k++) {
      pos.set(l[k]!, t * 9 + k * 3);
      nor.set(nl, t * 9 + k * 3);
      const [x, y, z] = w[k]!;
      // plano dominante: piso/teto → (x, z); parede virada para x → (z, y); virada para z → (x, y)
      const [s, r] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
      uv.set([s, r], t * 6 + k * 2);
    }
  }
  return { posicoes: pos, uv, normais: nor };
}

/** Posições de um atributo do three em Float32 (resolve quantização normalizada e buffer intercalado). */
export function posicoesReais(attr: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }): Float32Array {
  const r = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) {
    r[i * 3] = attr.getX(i);
    r[i * 3 + 1] = attr.getY(i);
    r[i * 3 + 2] = attr.getZ(i);
  }
  return r;
}
