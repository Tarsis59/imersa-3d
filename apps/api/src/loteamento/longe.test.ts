import { describe, expect, it } from 'vitest';
import { distanciaDoProjetoM, LONGE_DO_PROJETO_M } from '../rotas/lotes';
import type { Leitura } from './lotes';

// um lote quadrado de ~10 m em volta do ponto dado
const leitura = (lon: number, lat: number): Leitura =>
  ({
    lotes: [{ quadra: '01', numero: '1', areaM2: 100, frenteM: 10, fundoM: 10, contorno: [[lon, lat], [lon + 0.0001, lat], [lon + 0.0001, lat + 0.0001], [lon, lat + 0.0001]] }],
    avisos: [],
  }) as unknown as Leitura;

describe('loteamento longe do endereço do projeto', () => {
  const paulista = { lon: -46.6545, lat: -23.56175 };

  it('desenho no endereço: perto (sem aviso)', () => {
    expect(distanciaDoProjetoM(leitura(-46.6545, -23.56175), paulista)).toBeLessThan(LONGE_DO_PROJETO_M);
  });

  it('desenho a ~1,4 km (fuso ou coordenadas trocadas): passa do limite', () => {
    const d = distanciaDoProjetoM(leitura(-46.644967, -23.552981), paulista);
    expect(d).toBeGreaterThan(LONGE_DO_PROJETO_M);
    expect(d).toBeGreaterThan(1300);
    expect(d).toBeLessThan(1450);
  });
});
