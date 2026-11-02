import { describe, expect, it } from 'vitest';
import { calcularShiftVertical, limparShiftDeCaptura, LIMITE_PITCH_VERTICAIS_RETAS_RAD, pitchDoOlhar, verticaisRetasAtiva } from './verticaisRetas';

describe('quando a correção liga (Plano 12a, item 13)', () => {
  it('só na órbita, nunca na primeira pessoa', () => {
    expect(verticaisRetasAtiva('orbita', 0)).toBe(true);
    expect(verticaisRetasAtiva('primeira-pessoa', 0)).toBe(false);
  });

  it('dentro da faixa segura de pitch', () => {
    expect(verticaisRetasAtiva('orbita', 0.1)).toBe(true);
    expect(verticaisRetasAtiva('orbita', -0.1)).toBe(true);
    expect(verticaisRetasAtiva('orbita', LIMITE_PITCH_VERTICAIS_RETAS_RAD)).toBe(true); // no limite, ainda liga
  });

  it('fora da faixa segura (olhando quase para cima/baixo), desliga', () => {
    expect(verticaisRetasAtiva('orbita', LIMITE_PITCH_VERTICAIS_RETAS_RAD + 0.01)).toBe(false);
    expect(verticaisRetasAtiva('orbita', -(LIMITE_PITCH_VERTICAIS_RETAS_RAD + 0.01))).toBe(false);
    expect(verticaisRetasAtiva('orbita', Math.PI / 2)).toBe(false); // olhando bem para cima
  });
});

describe('pitch do olhar', () => {
  it('zero na horizontal', () => {
    expect(pitchDoOlhar({ x: 0, y: 10, z: 0 }, { x: 5, y: 10, z: 0 })).toBeCloseTo(0);
  });
  it('positivo olhando para cima, negativo para baixo', () => {
    expect(pitchDoOlhar({ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 10 })).toBeGreaterThan(0);
    expect(pitchDoOlhar({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 10 })).toBeLessThan(0);
  });
  it('45° olhando para cima e para a frente', () => {
    expect(pitchDoOlhar({ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 10 })).toBeCloseTo(Math.PI / 4);
  });
});

describe('cálculo do deslocamento (shift) do frustum', () => {
  it('sem inclinação (pitch 0), sem deslocamento', () => {
    expect(calcularShiftVertical(0, 50)).toBeCloseTo(0);
  });

  it('o deslocamento cresce com o ângulo; olhando para cima (pitch > 0) o sinal é negativo (offsetY do three.js)', () => {
    const a = calcularShiftVertical(0.2, 50);
    const b = calcularShiftVertical(0.35, 50);
    expect(Math.abs(b)).toBeGreaterThan(Math.abs(a));
    expect(Math.sign(a)).toBe(-Math.sign(0.2));
  });

  it('reproduz exatamente o enquadramento da câmera inclinada (checagem numérica com a câmera do three.js)', async () => {
    const THREE = await import('three');
    const fov = 50;
    const aspecto = 390 / 844;
    const pos = new THREE.Vector3(5, 2, -3);
    const alvo = new THREE.Vector3(5 + 12, 2 + 6, -3 - 9); // pitch positivo (olhando para cima e para a frente)

    const inclinada = new THREE.PerspectiveCamera(fov, aspecto, 0.1, 1000);
    inclinada.position.copy(pos);
    inclinada.lookAt(alvo);
    inclinada.updateMatrixWorld();
    const ndcInclinada = alvo.clone().project(inclinada);

    const pitch = pitchDoOlhar(pos, alvo);
    const nivelada = new THREE.PerspectiveCamera(fov, aspecto, 0.1, 1000);
    nivelada.position.copy(pos);
    const direcaoNivel = new THREE.Vector3(alvo.x - pos.x, 0, alvo.z - pos.z).normalize();
    nivelada.lookAt(pos.clone().add(direcaoNivel));
    nivelada.updateMatrixWorld();
    const w = 390;
    const h = 844;
    nivelada.setViewOffset(w, h, 0, calcularShiftVertical(pitch, fov) * h, w, h);
    const ndcNivelada = alvo.clone().project(nivelada);

    // a mesma coordenada de tela (x e y em NDC), com a câmera nivelada em vez de inclinada
    expect(ndcNivelada.x).toBeCloseTo(ndcInclinada.x, 5);
    expect(ndcNivelada.y).toBeCloseTo(ndcInclinada.y, 5);
    expect(Math.abs(ndcInclinada.y)).toBeLessThan(0.01); // a câmera inclinada olha direto para o alvo: y ≈ 0
  });

  it('olhar para baixo inverte o sinal do deslocamento', () => {
    expect(calcularShiftVertical(-0.2, 50)).toBeCloseTo(-calcularShiftVertical(0.2, 50));
  });

  it('campo de visão maior (mais grande angular) pede menos deslocamento para o mesmo ângulo', () => {
    const estreito = calcularShiftVertical(0.3, 35);
    const largo = calcularShiftVertical(0.3, 70);
    expect(Math.abs(largo)).toBeLessThan(Math.abs(estreito));
  });

  it('no limite seguro de pitch (35°), o deslocamento não passa de 1 altura de quadro (câmera de 50°)', () => {
    expect(Math.abs(calcularShiftVertical(LIMITE_PITCH_VERTICAIS_RETAS_RAD, 50))).toBeLessThan(1);
  });
});

describe('captura com pose própria não herda o shift da órbita (Plano 12c, regressão do giro 360°)', () => {
  it('sem limpar: um shift herdado desloca o alvo da nova pose fora do centro do quadro', async () => {
    const THREE = await import('three');
    const fov = 50;
    const w = 390;
    const h = 844;
    const camera = new THREE.PerspectiveCamera(fov, w / h, 0.1, 1000);
    // a órbita deixou um shift aplicado (verticais retas, olhando para cima)
    camera.position.set(0, 10, 20);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.setViewOffset(w, h, 0, calcularShiftVertical(0.3, fov) * h, w, h);

    // a captura (giro) reposiciona a câmera e aponta direto (sem nivelar) para um alvo novo
    const alvo = new THREE.Vector3(5, 8, -12);
    camera.position.set(0, 5, -30);
    camera.lookAt(alvo);
    camera.updateMatrixWorld();

    const ndc = alvo.clone().project(camera);
    expect(Math.abs(ndc.y)).toBeGreaterThan(0.01); // desalinhado: o alvo não cai no centro do quadro (shift vertical)
  });

  it('limparShiftDeCaptura: o alvo da nova pose volta a cair exatamente no centro do quadro', async () => {
    const THREE = await import('three');
    const fov = 50;
    const w = 390;
    const h = 844;
    const camera = new THREE.PerspectiveCamera(fov, w / h, 0.1, 1000);
    camera.position.set(0, 10, 20);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.setViewOffset(w, h, 0, calcularShiftVertical(0.3, fov) * h, w, h);

    const alvo = new THREE.Vector3(5, 8, -12);
    camera.position.set(0, 5, -30);
    camera.lookAt(alvo);
    limparShiftDeCaptura(camera);
    camera.updateMatrixWorld();

    const ndc = alvo.clone().project(camera);
    expect(ndc.x).toBeCloseTo(0, 5);
    expect(ndc.y).toBeCloseTo(0, 5);
  });
});
