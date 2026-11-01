import { describe, expect, it } from 'vitest';
import { temWebGpu } from './webgpu';

describe('medida de WebGPU', () => {
  it('só conta com adaptador de verdade; sem API ou com erro, não', async () => {
    expect(await temWebGpu({ gpu: { requestAdapter: async () => ({}) } })).toBe(true);
    expect(await temWebGpu({ gpu: { requestAdapter: async () => null } })).toBe(false); // API existe, placa bloqueada
    expect(await temWebGpu({})).toBe(false);
    expect(await temWebGpu({ gpu: { requestAdapter: async () => Promise.reject(new Error('x')) } })).toBe(false);
  });
});
