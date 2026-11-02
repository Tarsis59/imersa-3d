/**
 * `?renderizador=webgpu` na Vitrine (Plano 12a, item 16): opção experimental que NÃO troca o renderizador (os
 * shaders do projeto usam `onBeforeCompile`, que o WebGPURenderer do three.js não aceita) — só pede para destacar,
 * nesta visita, a capacidade WebGPU já medida (telemetria), para quem quiser acompanhar o aparelho na hora.
 * A decisão de trocar de verdade fica no painel (/painel/telemetria), pela % medida e pela regra explícita.
 */
export function pedidoRenderizadorExperimental(search: string): boolean {
  return new URLSearchParams(search).get('renderizador') === 'webgpu';
}
