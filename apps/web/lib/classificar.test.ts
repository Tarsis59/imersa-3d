import { describe, expect, it } from 'vitest';
import { classificar, coresDaImagem, lerExif, papeisPossiveis, pareceDesenho } from './classificar';
import { comExifGps } from '../e2e/exif';

const JPEG_VAZIO = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);

describe('EXIF', () => {
  it('lê o GPS nas duas ordens de bytes (sul e oeste negativos) e a câmera', () => {
    for (const le of [true, false]) {
      const x = lerExif(comExifGps(JPEG_VAZIO, -23.561414, -46.655881, { le }));
      expect(x.camera).toBe(true);
      expect(x.gps!.lat).toBeCloseTo(-23.561414, 5);
      expect(x.gps!.lon).toBeCloseTo(-46.655881, 5);
    }
    expect(lerExif(comExifGps(JPEG_VAZIO, 10.5, 20.25, { camera: false }))).toMatchObject({ camera: false, gps: { lat: 10.5, lon: 20.25 }, rumo: null });
    // bússola: para onde a câmera olhava
    for (const le of [true, false]) expect(lerExif(comExifGps(JPEG_VAZIO, -23.5, -46.6, { le, rumo: 271.5 })).rumo).toBeCloseTo(271.5, 5);
  });
  it('sem EXIF, PNG ou lixo: vazio, sem lançar', () => {
    const vazio = { gps: null, rumo: null, camera: false };
    expect(lerExif(JPEG_VAZIO)).toEqual(vazio);
    expect(lerExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual(vazio);
    const cortado = comExifGps(JPEG_VAZIO, -23.5, -46.6).subarray(0, 40);
    expect(lerExif(cortado)).toEqual(vazio);
  });
});

describe('classificar', () => {
  it('pela extensão', () => {
    expect(classificar('Projeto Legal.ifc')).toBe('ifc');
    expect(classificar('predio.glb')).toBe('modelo');
    expect(classificar('sala.spz')).toBe('splat');
    expect(classificar('passeio.MOV')).toBe('captura');
    expect(classificar('fotos.zip')).toBe('captura');
    expect(classificar('unidades.xlsx')).toBe('planilha');
    expect(classificar('descricao.txt')).toBe('texto');
    expect(classificar('tipo.dxf')).toBe('planta');
    expect(classificar('arquivo.exe')).toBeNull();
  });
  it('PDF: planta pelo nome, senão documento', () => {
    expect(classificar('Planta Pavimento Tipo.pdf')).toBe('planta');
    expect(classificar('PL-01 Térreo.pdf')).toBe('planta');
    expect(classificar('Memorial descritivo.pdf')).toBe('documento');
    expect(classificar('Book de vendas.pdf')).toBe('documento');
  });
  it('imagem: nome, câmera e cores', () => {
    expect(classificar('Fachada noturna.jpg')).toBe('fachada');
    expect(classificar('perspectiva_piscina.png')).toBe('render');
    expect(classificar('planta-humanizada-2q.png')).toBe('planta');
    expect(classificar('IMG_2041.JPG', { camera: true })).toBe('foto');
    expect(classificar('imagem1.png', { desenho: true })).toBe('planta');
    expect(classificar('imagem1.webp', { desenho: true })).toBe('foto');
    expect(classificar('imagem1.png')).toBe('foto');
  });
  it('papéis possíveis respeitam o que a API aceita por tipo', () => {
    expect(papeisPossiveis('a.webp')).not.toContain('planta');
    expect(papeisPossiveis('a.pdf')).toEqual(['planta', 'documento']);
  });
});

describe('cores', () => {
  const imagem = (px: Array<[number, number, number]>) => new Uint8Array(px.flatMap(([r, g, b]) => [r, g, b, 255]));
  it('planta (branco + traço preto) parece desenho; foto colorida e foto escura não', () => {
    const planta = imagem([...Array(80).fill([250, 250, 250]), ...Array(20).fill([30, 30, 30])]);
    expect(pareceDesenho(coresDaImagem(planta))).toBe(true);
    const foto = imagem([...Array(50).fill([120, 160, 220]), ...Array(50).fill([90, 140, 60])]);
    expect(pareceDesenho(coresDaImagem(foto))).toBe(false);
    const noite = imagem(Array(100).fill([20, 20, 30]));
    expect(pareceDesenho(coresDaImagem(noite))).toBe(false);
    // render com céu claro e muita cor também não
    const render = imagem([...Array(55).fill([235, 240, 250]), ...Array(45).fill([200, 120, 60])]);
    expect(pareceDesenho(coresDaImagem(render))).toBe(false);
  });
  it('pixels transparentes não contam', () => {
    expect(coresDaImagem(new Uint8Array([0, 0, 0, 0]))).toEqual({ brancos: 0, escuros: 0, saturacao: 0 });
  });
});
