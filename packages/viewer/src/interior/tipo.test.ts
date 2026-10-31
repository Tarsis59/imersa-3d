import { describe, it, expect } from 'vitest';
import { tipoDoSplat } from './tipo';

describe('tipo do arquivo de splat pelo nome', () => {
  it('formatos aceitos pela API', () => {
    expect(tipoDoSplat('sala.SPLAT')).toBe('splat');
    expect(tipoDoSplat('sala.ply')).toBe('ply');
    expect(tipoDoSplat('sala.spz')).toBe('spz');
    expect(tipoDoSplat('apto 101.sog')).toBe('pcsogszip');
  });

  it('outros: não abre', () => {
    expect(tipoDoSplat('casa.glb')).toBeNull();
    expect(tipoDoSplat('splat')).toBeNull();
  });
});
