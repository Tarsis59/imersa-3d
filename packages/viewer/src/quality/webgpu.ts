/**
 * O aparelho tem WebGPU de verdade (o navegador entrega um adaptador)? Só a medida, para a telemetria: o 3D continua
 * no WebGL até a maioria das clientes ter WebGPU (o renderizador WebGPU do three ainda não tem as sombras em
 * cascata, o raio-x da cidade e o path tracing que o 3D usa hoje).
 */
export async function temWebGpu(nav: { gpu?: { requestAdapter(): Promise<unknown> } } = typeof navigator === 'undefined' ? {} : (navigator as never)): Promise<boolean> {
  try {
    return Boolean(await nav.gpu?.requestAdapter());
  } catch {
    return false;
  }
}
