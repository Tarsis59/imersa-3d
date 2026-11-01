/** O que o aparelho permite: óculos de VR (WebXR), maquete na mesa pela câmera (WebXR AR) e AR do iPhone (Quick Look). */
export interface SuporteImersivo {
  vr: boolean;
  ar: boolean;
  quickLook: boolean;
}

interface XrMinimo {
  isSessionSupported(modo: string): Promise<boolean>;
}

/**
 * Pergunta ao navegador o que ele sabe abrir. Os botões só aparecem onde funciona: nada de "Ver em VR" num
 * computador sem óculos. O iPhone não tem WebXR; lá o AR é o Quick Look da Apple (link `rel="ar"`).
 */
export async function suporteImersivo(nav: { xr?: XrMinimo } = navigator as never, doc: Pick<Document, 'createElement'> | null = typeof document === 'undefined' ? null : document): Promise<SuporteImersivo> {
  const perguntar = async (modo: string) => {
    try {
      return (await nav.xr?.isSessionSupported(modo)) === true;
    } catch {
      return false; // bloqueado por política (iframe sem permissão) ou contexto inseguro
    }
  };
  const [vr, ar] = await Promise.all([perguntar('immersive-vr'), perguntar('immersive-ar')]);
  let quickLook = false;
  try {
    quickLook = doc?.createElement('a').relList.supports('ar') === true;
  } catch {
    quickLook = false;
  }
  return { vr, ar, quickLook };
}
