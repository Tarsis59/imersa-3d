import { describe, it, expect } from 'vitest';
import * as SunCalc from 'suncalc';
import { sunDirection, horaSaoPauloParaUtc } from './sun';

const SP = { lat: -23.56175, lon: -46.6545 };

describe('horaSaoPauloParaUtc', () => {
  it('15:30 em São Paulo = 18:30 UTC', () => {
    const d = horaSaoPauloParaUtc('2026-06-21', 15.5);
    expect(d.toISOString()).toBe('2026-06-21T18:30:00.000Z');
  });
});

describe('sunDirection', () => {
  it('vetor unitário', () => {
    const v = sunDirection(horaSaoPauloParaUtc('2026-03-20', 10), SP.lat, SP.lon);
    expect(v.length()).toBeCloseTo(1, 6);
  });

  it('meio-dia solar de junho: sol ao NORTE (z<0) e ~43° de altura', () => {
    const noon = SunCalc.getTimes(new Date('2026-06-21T15:00:00Z'), SP.lat, SP.lon).solarNoon;
    const v = sunDirection(noon, SP.lat, SP.lon);
    const altura = (Math.asin(v.y) * 180) / Math.PI;
    expect(v.z).toBeLessThan(0);
    expect(Math.abs(v.x)).toBeLessThan(0.05);
    expect(altura).toBeGreaterThan(41);
    expect(altura).toBeLessThan(45);
  });

  it('manhã: sol a LESTE (x>0); tarde: a OESTE (x<0)', () => {
    expect(sunDirection(horaSaoPauloParaUtc('2026-12-21', 8), SP.lat, SP.lon).x).toBeGreaterThan(0);
    expect(sunDirection(horaSaoPauloParaUtc('2026-12-21', 17), SP.lat, SP.lon).x).toBeLessThan(0);
  });
});
