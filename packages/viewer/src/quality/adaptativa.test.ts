import { describe, it, expect } from 'vitest';
import { QualidadeAdaptativa, NIVEIS } from './adaptativa';

/** Simula `ms` de quadros a `fps`; devolve os nomes dos níveis para os quais trocou. */
function rodar(q: QualidadeAdaptativa, fps: number, ms: number): string[] {
  const trocas: string[] = [];
  const dt = 1000 / fps;
  for (let t = 0; t < ms; t += dt) {
    const n = q.registrar(dt);
    if (n) trocas.push(n.nome);
  }
  return trocas;
}

describe('qualidade adaptativa', () => {
  it('níveis do mais bonito ao mais leve', () => {
    expect(NIVEIS.map((n) => n.nome)).toEqual(['alto', 'medio', 'baixo']);
    expect(NIVEIS[2]!.sombras).toBe(false);
  });

  it('60 FPS: fica no alto', () => {
    const q = new QualidadeAdaptativa();
    expect(rodar(q, 60, 20_000)).toEqual([]);
    expect(q.nivel.nome).toBe('alto');
    expect(q.fps).toBeCloseTo(60, 0);
  });

  it('20 FPS: desce um nível por vez, esperando entre trocas, e para no baixo', () => {
    const q = new QualidadeAdaptativa();
    expect(rodar(q, 20, 3_500)).toEqual(['medio']);
    expect(rodar(q, 20, 1_000)).toEqual([]); // ainda esperando
    expect(rodar(q, 20, 30_000)).toEqual(['baixo']);
    expect(q.nivel.nome).toBe('baixo');
  });

  it('40 FPS (entre os limites): não mexe', () => {
    const q = new QualidadeAdaptativa({ inicial: 1 });
    expect(rodar(q, 40, 30_000)).toEqual([]);
  });

  it('sobe só depois de 5 s seguidos acima de 50 FPS', () => {
    const q = new QualidadeAdaptativa({ inicial: 2 });
    expect(rodar(q, 60, 4_000)).toEqual([]);
    rodar(q, 10, 500); // queda curta: quebra a sequência (média < 50) sem chegar a descer
    expect(rodar(q, 60, 4_500)).toEqual([]);
    // os quadros lentos saem da janela de 2 s ~1,6 s depois; aí começam a contar os 5 s
    expect(rodar(q, 60, 3_000)).toEqual(['medio']);
    expect(rodar(q, 60, 60_000)).toEqual(['alto']);
  });

  it('quadro longo isolado (aba em segundo plano) é ignorado', () => {
    const q = new QualidadeAdaptativa();
    rodar(q, 60, 4_000);
    expect(q.registrar(5_000)).toBeNull();
    expect(rodar(q, 60, 3_000)).toEqual([]);
    expect(q.nivel.nome).toBe('alto');
  });

  it('pixel ratio respeita a tela do aparelho', () => {
    expect(new QualidadeAdaptativa().pixelRatio(3)).toBe(2);
    expect(new QualidadeAdaptativa().pixelRatio(1)).toBe(1);
    expect(new QualidadeAdaptativa({ inicial: 2 }).pixelRatio(3)).toBe(1);
  });
});
