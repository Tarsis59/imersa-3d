/**
 * Outros formatos 3D → GLB, no navegador, com o assimpjs (Assimp em WebAssembly, MIT). O arquivo não sobe para o
 * servidor grátis (pouca memória): só o GLB convertido é enviado, pelo fluxo normal de Arquivos (verificado).
 * Formatos testados: OBJ (+ MTL), DAE (Collada), STL, 3DS, FBX. SketchUp (.skp) não tem leitor livre: no SketchUp,
 * exporte como DAE ou IFC.
 */
export const EXTENSOES_CONVERSIVEIS = ['.fbx', '.obj', '.dae', '.3ds', '.stl', '.gltf'] as const;
/** Arquivos que acompanham o principal (materiais e texturas do OBJ/FBX/DAE). */
export const EXTENSOES_APOIO = ['.mtl', '.png', '.jpg', '.jpeg', '.bin'] as const;

export interface ArquivoModelo {
  nome: string;
  dados: Uint8Array;
}

/** O pedaço do assimpjs que usamos. */
export interface Assimp {
  FileList: new () => { AddFile(nome: string, dados: Uint8Array): void };
  ConvertFileList(lista: unknown, formato: 'glb2'): {
    IsSuccess(): boolean;
    FileCount(): number;
    GetErrorCode(): string;
    GetFile(i: number): { GetContent(): Uint8Array };
  };
}

const extensao = (n: string) => n.slice(n.lastIndexOf('.')).toLowerCase();

/** Arquivo principal: o primeiro em formato 3D (os outros são materiais e texturas). */
export function arquivoPrincipal(nomes: readonly string[]): string | null {
  return nomes.find((n) => (EXTENSOES_CONVERSIVEIS as readonly string[]).includes(extensao(n))) ?? null;
}

export function nomeDoGlb(principal: string): string {
  return `${principal.slice(0, principal.lastIndexOf('.'))}.glb`;
}

export class ErroConversao extends Error {}

export function converterParaGlb(ajs: Assimp, arquivos: readonly ArquivoModelo[]): Uint8Array {
  const principal = arquivoPrincipal(arquivos.map((a) => a.nome));
  if (!principal) throw new ErroConversao(`Escolha um arquivo 3D (${EXTENSOES_CONVERSIVEIS.join(', ')}).`);
  const lista = new ajs.FileList();
  // o principal primeiro: o Assimp converte o primeiro arquivo da lista e usa os outros como apoio
  for (const a of [...arquivos].sort((x, y) => Number(y.nome === principal) - Number(x.nome === principal))) lista.AddFile(a.nome, a.dados);
  const r = ajs.ConvertFileList(lista, 'glb2');
  if (!r.IsSuccess() || r.FileCount() === 0) throw new ErroConversao(`Não foi possível converter ${principal} (${r.GetErrorCode() || 'formato não reconhecido'}).`);
  const glb = r.GetFile(0).GetContent();
  if (new TextDecoder().decode(glb.subarray(0, 4)) !== 'glTF') throw new ErroConversao('A conversão não gerou um GLB válido.');
  return glb;
}

declare global {
  interface Window {
    assimpjs?: (opcoes?: { locateFile?: (f: string) => string }) => Promise<Assimp>;
  }
}

let carregando: Promise<Assimp> | null = null;
/** Carrega o assimpjs (3 MB) só quando alguém converte. */
export function carregarAssimp(base = '/decodificadores/assimp/'): Promise<Assimp> {
  carregando ??= new Promise<Assimp>((ok, erro) => {
    const usar = () => window.assimpjs!({ locateFile: (f) => base + f }).then(ok, erro);
    if (window.assimpjs) return usar();
    const s = document.createElement('script');
    s.src = `${base}assimpjs.js`;
    s.onload = usar;
    s.onerror = () => {
      carregando = null;
      erro(new ErroConversao('Não foi possível carregar o conversor de formatos 3D.'));
    };
    document.head.append(s);
  });
  return carregando;
}
