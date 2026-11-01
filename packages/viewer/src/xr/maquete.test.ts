import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { escalaDaMaquete, gestoDeDoisDedos, limitarEscala, montarMaquete, pontoDeEntrada } from './maquete';
import { suporteImersivo } from './suporte';

const PREDIO = { minX: -10, maxX: 10, minY: 0, maxY: 45, minZ: -6, maxZ: 6 };

describe('maquete na mesa', () => {
  it('o maior lado (aqui a altura) vira 50 cm', () => {
    expect(escalaDaMaquete(PREDIO) * 45).toBeCloseTo(0.5, 6);
    expect(escalaDaMaquete({ ...PREDIO, maxY: 5 }) * 20).toBeCloseTo(0.5, 6); // prédio baixo: a largura manda
    expect(escalaDaMaquete({ minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 })).toBe(1);
  });

  it('pinça aumenta e diminui; dedos girando giram', () => {
    const g = gestoDeDoisDedos({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 200, y: 0 });
    expect(g.escala).toBeCloseTo(2);
    expect(g.rotacao).toBeCloseTo(0);
    const r = gestoDeDoisDedos({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 });
    expect(r.escala).toBeCloseTo(1);
    expect(r.rotacao).toBeCloseTo(Math.PI / 2);
    // passando de 180°: o menor giro, não a volta inteira
    const v = gestoDeDoisDedos({ x: 0, y: 0 }, { x: -100, y: 1 }, { x: 0, y: 0 }, { x: -100, y: -1 });
    expect(Math.abs(v.rotacao)).toBeLessThan(0.1);
    // dedos no mesmo ponto: não explode
    expect(gestoDeDoisDedos({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 0, y: 0 }, { x: 9, y: 9 }).escala).toBe(1);
  });

  it('a escala tem limite (não some nem vira prédio de verdade na sala)', () => {
    expect(limitarEscala(0.0001, 0.01)).toBeCloseTo(0.0025);
    expect(limitarEscala(1, 0.01)).toBeCloseTo(0.06);
    expect(limitarEscala(0.02, 0.01)).toBeCloseTo(0.02);
  });

  it('desfaz as instâncias, centraliza e apoia no chão, com os mesmos materiais', () => {
    const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    const unidade = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), material);
    unidade.position.set(30, 1.5, -20);
    const arvores = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 3);
    for (let i = 0; i < 3; i++) {
      arvores.setMatrixAt(i, new THREE.Matrix4().makeTranslation(30 + i * 2, 0.5, -15));
      arvores.setColorAt(i, new THREE.Color(i === 0 ? 0xff0000 : 0x00ff00));
    }
    const escondida = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), material);
    escondida.visible = false;
    const raiz = new THREE.Group();
    raiz.add(unidade, arvores, escondida);

    const maquete = montarMaquete([raiz]);
    const malhas: THREE.Mesh[] = [];
    maquete.traverse((o) => o instanceof THREE.Mesh && malhas.push(o));
    expect(malhas).toHaveLength(4); // 1 unidade + 3 árvores; a escondida fica de fora
    expect(malhas.some((m) => m instanceof THREE.InstancedMesh)).toBe(false);
    expect(malhas[0]!.material).toBe(material); // a situação da unidade continua igual na maquete
    expect((malhas[1]!.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff0000); // cor da instância

    maquete.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(maquete);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 6);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0, 6);
    expect(Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z)).toBeCloseTo(0.5, 6);
  });
});

describe('passeio em VR', () => {
  it('começa no chão, na frente da entrada, longe o bastante para ver o prédio', () => {
    const p = pontoDeEntrada(PREDIO);
    expect(p).toEqual({ x: 0, y: 0, z: 6 + 12 });
    expect(pontoDeEntrada({ ...PREDIO, minX: -1, maxX: 1 }).z).toBe(6 + 8); // mínimo de 8 m
    expect(pontoDeEntrada({ ...PREDIO, minX: -200, maxX: 200 }).z).toBe(6 + 40); // máximo de 40 m
  });
});

describe('o que o aparelho permite', () => {
  const doc = (ar: boolean) => ({ createElement: () => ({ relList: { supports: (t: string) => ar && t === 'ar' } }) }) as never;

  it('Quest: VR sim; Android: AR sim; iPhone: Quick Look', async () => {
    const xr = (modos: string[]) => ({ isSessionSupported: async (m: string) => modos.includes(m) });
    expect(await suporteImersivo({ xr: xr(['immersive-vr']) }, doc(false))).toEqual({ vr: true, ar: false, quickLook: false });
    expect(await suporteImersivo({ xr: xr(['immersive-ar']) }, doc(false))).toEqual({ vr: false, ar: true, quickLook: false });
    expect(await suporteImersivo({}, doc(true))).toEqual({ vr: false, ar: false, quickLook: true });
  });

  it('erro do navegador (política, contexto inseguro) vira "não"', async () => {
    const xr = { isSessionSupported: async () => Promise.reject(new Error('SecurityError')) };
    expect(await suporteImersivo({ xr }, null)).toEqual({ vr: false, ar: false, quickLook: false });
  });
});
