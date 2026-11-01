import { describe, it, expect } from 'vitest';
import { conferirConteudo, extensao, nomeSeguro, tipoDeConteudo, validarDeclaracao } from './tipos';

const MB = 1024 * 1024;
const bytes = (...b: number[]) => Buffer.from(b);
const texto = (s: string) => Buffer.from(s, 'latin1');

describe('declaração do arquivo', () => {
  it('aceita extensão e tamanho dentro da regra do tipo', () => {
    expect(validarDeclaracao('modelo_3d', 'Casa.GLB', 10 * MB)).toBeNull();
    expect(validarDeclaracao('splat', 'sala.spz', 900 * MB)).toBeNull();
    expect(validarDeclaracao('planta', 'planta-1.pdf', MB)).toBeNull();
  });
  it('recusa extensão errada para o tipo', () => {
    expect(validarDeclaracao('modelo_3d', 'casa.obj', MB)).toBe('extensão não aceita para modelo_3d: use .glb');
    expect(validarDeclaracao('imagem', 'virus.exe', MB)).toMatch(/extensão não aceita/);
  });
  it('recusa acima do limite', () => {
    expect(validarDeclaracao('imagem', 'foto.jpg', 31 * MB)).toBe('arquivo maior que o limite de 30 MB');
  });
});

describe('conteúdo real (assinatura binária)', () => {
  it.each([
    ['casa.glb', texto('glTF\u0002\u0000\u0000\u0000'), 1000],
    ['planta.pdf', texto('%PDF-1.7\n'), 1000],
    ['foto.png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0), 1000],
    ['foto.jpg', bytes(0xff, 0xd8, 0xff, 0xe0), 1000],
    ['foto.webp', texto('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '), 1000],
    ['modelo.ifc', texto('ISO-10303-21;\nHEADER;'), 1000],
    ['sala.spz', bytes(0x1f, 0x8b, 0x08), 1000],
    ['sala-nova.spz', texto('NGSP\u0003\u0000\u0000\u0000'), 1000], // SPZ v3+ (Niantic): cabeçalho NGSP sem gzip
    ['sala.sog', bytes(0x50, 0x4b, 0x03, 0x04), 1000],
    ['sala.ply', texto('ply\nformat binary'), 1000],
    ['sala.splat', bytes(1, 2, 3), 32 * 1000],
    ['fotos.zip', bytes(0x50, 0x4b, 0x03, 0x04), 1000],
    ['visita.mp4', texto('\u0000\u0000\u0000 ftypisom'), 1000],
    ['visita.mov', texto('\u0000\u0000\u0000\u0014ftypqt  '), 1000],
  ])('%s confere', (nome, inicio, tamanho) => expect(conferirConteudo(nome, inicio, tamanho)).toBeNull());

  it.each([
    ['casa.glb', texto('MZ\u0090\u0000')],
    ['planta.pdf', texto('<html>')],
    ['foto.jpg', bytes(0x89, 0x50, 0x4e, 0x47)],
    ['modelo.ifc', texto('glTF')],
    ['sala.spz', texto('MZ\u0090\u0000')],
    ['fotos.zip', texto('MZ\u0090\u0000')],
    ['visita.mp4', texto('<html><body>')],
  ])('%s com conteúdo de outro tipo é recusado', (nome, inicio) => {
    expect(conferirConteudo(nome, inicio, 1000)).toBe('o conteúdo não corresponde ao tipo do arquivo');
  });

  it('.splat precisa ter tamanho múltiplo de 32 bytes', () => {
    expect(conferirConteudo('sala.splat', bytes(1), 33)).toBe('o conteúdo não corresponde ao tipo do arquivo');
  });
});

describe('nomes', () => {
  it('extensão em minúsculas', () => expect(extensao('A.B.GLB')).toBe('.glb'));
  it('nome seguro para o armazenamento', () => {
    expect(nomeSeguro('Planta Térreo (rev 2).pdf')).toBe('Planta_T_rreo__rev_2_.pdf');
    expect(nomeSeguro('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(nomeSeguro(`${'a'.repeat(300)}.glb`)).toHaveLength(100);
    expect(nomeSeguro(`${'a'.repeat(300)}.glb`).endsWith('.glb')).toBe(true);
  });
  it('tipo de conteúdo pela extensão', () => {
    expect(tipoDeConteudo('casa.glb')).toBe('model/gltf-binary');
    expect(tipoDeConteudo('sala.spz')).toBe('application/octet-stream');
  });
});

describe('captura (fotos ZIP ou vídeo do celular)', () => {
  it('aceita .zip, .mp4 e .mov até 3 GB; recusa outras extensões', () => {
    expect(validarDeclaracao('captura', 'fotos.zip', 2900 * MB)).toBeNull();
    expect(validarDeclaracao('captura', 'visita.MOV', 100 * MB)).toBeNull();
    expect(validarDeclaracao('captura', 'fotos.rar', 10)).toMatch(/extensão não aceita/);
    expect(validarDeclaracao('captura', 'visita.mp4', 3100 * MB)).toMatch(/limite/);
  });
});

describe('planta em DXF', () => {
  it('aceita DXF texto (código 0 ou comentário 999) e binário; recusa outra coisa com extensão .dxf', () => {
    expect(validarDeclaracao('planta', 'casa.dxf', 1000)).toBeNull();
    const t = (s: string) => Buffer.from(s, 'latin1');
    expect(conferirConteudo('casa.dxf', t('  0\r\nSECTION\r\n'), 100)).toBeNull();
    expect(conferirConteudo('casa.dxf', t('999\nfeito no CAD\n'), 100)).toBeNull();
    expect(conferirConteudo('casa.dxf', t('AutoCAD Binary DXF\r\n'), 100)).toBeNull();
    expect(conferirConteudo('casa.dxf', t('<html><body>'), 100)).not.toBeNull();
  });
});
