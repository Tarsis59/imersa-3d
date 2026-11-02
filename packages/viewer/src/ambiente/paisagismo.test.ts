import { describe, it, expect } from 'vitest';
import { planejarPaisagismo } from './paisagismo';

const PREDIO = { minX: -8, maxX: 8, minY: 0, maxY: 30, minZ: -8, maxZ: 8 };

describe('paisagismo do lote', () => {
  it('gramado em volta do prédio e calçada em volta do gramado', () => {
    const p = planejarPaisagismo(PREDIO);
    expect(p.gramado.minX).toBeLessThan(PREDIO.minX);
    expect(p.calcada.minX).toBeLessThan(p.gramado.minX);
    expect(p.calcada.maxZ).toBeGreaterThan(p.gramado.maxZ);
  });

  it('árvores fora do prédio e longe da entrada (frente, lado +z)', () => {
    const p = planejarPaisagismo(PREDIO);
    expect(p.arvores.length).toBeGreaterThan(4);
    for (const a of p.arvores) {
      const dentroDoPredio = a.x > PREDIO.minX - a.raio && a.x < PREDIO.maxX + a.raio && a.z > PREDIO.minZ - a.raio && a.z < PREDIO.maxZ + a.raio;
      expect(dentroDoPredio).toBe(false);
      expect(a.z > PREDIO.maxZ && Math.abs(a.x) < 3.5).toBe(false);
      expect(a.altura).toBeGreaterThanOrEqual(4.5);
      expect(a.altura).toBeLessThanOrEqual(8);
    }
  });

  it('sempre o mesmo para o mesmo prédio (não muda a cada visita)', () => {
    expect(planejarPaisagismo(PREDIO)).toEqual(planejarPaisagismo(PREDIO));
  });

  it('nada dentro dos prédios vizinhos', () => {
    const vizinho = { minX: 9, maxX: 40, minY: 0, maxY: 50, minZ: -40, maxZ: 40 }; // colado no lado leste
    const p = planejarPaisagismo(PREDIO, [vizinho]);
    for (const a of p.arvores) expect(a.x > vizinho.minX - a.raio && a.z > vizinho.minZ && a.z < vizinho.maxZ).toBe(false);
    for (const q of p.postes) expect(q.x > vizinho.minX - 0.5 && q.z > vizinho.minZ && q.z < vizinho.maxZ).toBe(false);
    expect(p.arvores.length).toBeLessThan(planejarPaisagismo(PREDIO).arvores.length);
  });
});

describe('vento nas copas', () => {
  it('encaixa no shader do three e respeita quem já mexia no material', async () => {
    const THREE = await import('three');
    const { balancarComVento, VENTO } = await import('./vegetacao');
    const m = new THREE.MeshStandardMaterial();
    let antes = 0;
    m.onBeforeCompile = () => void antes++;
    balancarComVento(m);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: '' } as unknown as Parameters<typeof m.onBeforeCompile>[0];
    m.onBeforeCompile(shader, undefined as never);
    expect(antes).toBe(1);
    expect(shader.vertexShader).toContain('uniform float uVento;');
    expect(shader.vertexShader).toContain('transformed.x += sin(uVento');
    expect((shader.uniforms as Record<string, unknown>).uVento).toBe(VENTO.tempo);
    expect(m.customProgramCacheKey()).toMatch(/-vento$/);
  });
});
