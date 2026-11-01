/**
 * JPEG com EXIF de câmera e GPS (testes do classificador e da criação integrada): põe um segmento APP1 logo depois
 * do início do JPEG. `le` escolhe a ordem dos bytes do TIFF (os celulares usam as duas).
 */
export function comExifGps(jpeg: Uint8Array, lat: number, lon: number, o: { le?: boolean; camera?: boolean } = {}): Uint8Array {
  const le = o.le ?? true;
  const camera = o.camera ?? true;
  const tiff = new DataView(new ArrayBuffer(512));
  let fim = 0;
  const u16 = (p: number, v: number) => tiff.setUint16(p, v, le);
  const u32 = (p: number, v: number) => tiff.setUint32(p, v, le);
  tiff.setUint16(0, le ? 0x4949 : 0x4d4d);
  u16(2, 42);
  u32(4, 8);
  // IFD0: Make (opcional) + ponteiro do GPS
  const n0 = camera ? 2 : 1;
  u16(8, n0);
  let e = 10;
  const dadosIfd0 = 10 + n0 * 12 + 4;
  if (camera) {
    u16(e, 0x010f);
    u16(e + 2, 2);
    u32(e + 4, 6);
    u32(e + 8, dadosIfd0);
    'Teste\0'.split('').forEach((c, i) => tiff.setUint8(dadosIfd0 + i, c.charCodeAt(0)));
    e += 12;
  }
  const gpsIfd = dadosIfd0 + 8;
  u16(e, 0x8825);
  u16(e + 2, 4);
  u32(e + 4, 1);
  u32(e + 8, gpsIfd);
  u32(e + 12, 0);
  // GPS IFD: 1 LatRef, 2 Lat, 3 LonRef, 4 Lon
  u16(gpsIfd, 4);
  const dados = gpsIfd + 2 + 4 * 12 + 4;
  const ent = (i: number, tag: number, tipo: number, qtd: number, valor: (p: number) => void) => {
    const p = gpsIfd + 2 + i * 12;
    u16(p, tag);
    u16(p + 2, tipo);
    u32(p + 4, qtd);
    valor(p + 8);
  };
  const racionais = (p: number, v: number) => {
    const a = Math.abs(v);
    const g = Math.floor(a);
    const m = Math.floor((a - g) * 60);
    const s = Math.round(((a - g) * 60 - m) * 60 * 10000);
    [g, 1, m, 1, s, 10000].forEach((x, i) => u32(p + i * 4, x));
  };
  ent(0, 1, 2, 2, (p) => tiff.setUint8(p, (lat < 0 ? 'S' : 'N').charCodeAt(0)));
  ent(1, 2, 5, 3, (p) => u32(p, dados));
  ent(2, 3, 2, 2, (p) => tiff.setUint8(p, (lon < 0 ? 'W' : 'E').charCodeAt(0)));
  ent(3, 4, 5, 3, (p) => u32(p, dados + 24));
  u32(gpsIfd + 2 + 4 * 12, 0);
  racionais(dados, lat);
  racionais(dados + 24, lon);
  fim = dados + 48;
  const corpo = new Uint8Array(tiff.buffer, 0, fim);
  const app1 = new Uint8Array(4 + 6 + fim);
  app1.set([0xff, 0xe1, ((app1.length - 2) >> 8) & 0xff, (app1.length - 2) & 0xff], 0);
  app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  app1.set(corpo, 10);
  const saida = new Uint8Array(jpeg.length + app1.length);
  saida.set(jpeg.subarray(0, 2), 0);
  saida.set(app1, 2);
  saida.set(jpeg.subarray(2), 2 + app1.length);
  return saida;
}
