import * as THREE from 'three';
import { areaVisivel, grupoDaPeca, ordenarGrupos, type CategoriaMaterial, type DefinicaoGrupo } from './superficies';
import { posicoesReais, uvCaixa } from './uv';
import { chaveDoDesenho, desenharPadrao, type Acabamento, type Contexto2D } from './padroes';
import { movelPadrao, type PoseMovel } from './moveis';

/** Superfície que a cliente personaliza: um grupo de peças do modelo com a área visível somada. */
export interface Superficie {
  chave: string;
  rotulo: string;
  categoria: CategoriaMaterial;
  /** Área estimada pelo 3D (faces na orientação do grupo), em m², com 2 casas. */
  areaM2: number;
  pecas: number;
}

export type FonteMovel = { padrao: string } | { url: string };

interface Grupo {
  def: DefinicaoGrupo;
  malhas: THREE.Mesh[];
  area: number;
  /** material único do grupo (trocar = mudar números e textura, sem recompilar o shader) */
  material: THREE.MeshStandardMaterial | null;
  originais: Map<THREE.Mesh, { material: THREE.Material | THREE.Material[]; geometria: THREE.BufferGeometry }>;
}

const TAMANHO_TEXTURA = 512;

export interface Dependencias {
  /** Ajuste comum a todo material da cena (sombras em cascata, corte por andar). */
  prepararMaterial: (m: THREE.Material) => void;
  carregarGltf: (url: string) => Promise<THREE.Object3D>;
  /** Tipo IFC da peça (extras do glTF). */
  tipoIfc: (o: THREE.Object3D) => string | undefined;
  /** Canvas para desenhar as texturas (no navegador, `document.createElement('canvas')`). */
  criarCanvas?: () => HTMLCanvasElement;
}

/**
 * Acabamentos e móveis do configurador sobre o modelo já na cena. As peças de `ignorar` (ambientes ligados a
 * unidades, pintados pelo status) ficam de fora.
 */
export function criarConfigurador(modelo: THREE.Object3D, cena: THREE.Scene, ignorar: ReadonlySet<THREE.Object3D>, dep: Dependencias) {
  const criarCanvas = dep.criarCanvas ?? (() => document.createElement('canvas'));
  const grupos = new Map<string, Grupo>();
  modelo.updateMatrixWorld(true);
  modelo.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || ignorar.has(o) || !o.visible) return;
    const original = Array.isArray(o.material) ? o.material[0] : o.material;
    const extras = (o.userData.ifc ? o.userData : (o.parent?.userData ?? {})) as { ifcTipo?: string; ifcPai?: string };
    const def = grupoDaPeca(dep.tipoIfc(o), original?.name, { predefinido: extras.ifcTipo, pai: extras.ifcPai });
    if (!def) return;
    const g: Grupo = grupos.get(def.chave) ?? { def, malhas: [], area: 0, material: null, originais: new Map() };
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    g.malhas.push(o);
    // posições reais (o GLB otimizado quantiza; a escala fica no nó, que a matrixWorld já traz)
    g.area += areaVisivel(posicoesReais(pos), o.geometry.index?.array ?? null, o.matrixWorld.elements, def.orientacao);
    grupos.set(def.chave, g);
  });

  // textura branca para "liso": todo material do grupo tem mapa, então trocar não muda o shader
  const branca = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  branca.colorSpace = THREE.SRGBColorSpace;
  branca.needsUpdate = true;
  const texturas = new Map<string, THREE.Texture>();
  function textura(a: Acabamento): THREE.Texture {
    if (a.padrao === 'liso') return branca;
    const chave = chaveDoDesenho(a);
    const pronta = texturas.get(chave);
    if (pronta) return pronta;
    const canvas = criarCanvas();
    canvas.width = TAMANHO_TEXTURA;
    canvas.height = TAMANHO_TEXTURA;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Sem suporte a canvas 2D');
    desenharPadrao(ctx as unknown as Contexto2D, TAMANHO_TEXTURA, a);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    texturas.set(chave, t);
    return t;
  }

  /** Geometria com UV em metros (o IFC não traz UV), feita uma vez por peça. */
  const comUv = new Map<THREE.Mesh, THREE.BufferGeometry>();
  function geometriaComUv(malha: THREE.Mesh): THREE.BufferGeometry {
    const pronta = comUv.get(malha);
    if (pronta) return pronta;
    const r = uvCaixa(posicoesReais(malha.geometry.getAttribute('position')), malha.geometry.index?.array ?? null, malha.matrixWorld.elements);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(r.posicoes, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(r.normais, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(r.uv, 2));
    comUv.set(malha, geo);
    return geo;
  }

  /** Na primeira troca do grupo: as peças passam a usar a geometria com UV e o material único do grupo. */
  function prepararGrupo(g: Grupo): THREE.MeshStandardMaterial {
    if (g.material && g.malhas.every((x) => x.material === g.material)) return g.material;
    const m = g.material ?? new THREE.MeshStandardMaterial({ map: branca });
    m.name = `acabamento:${g.def.chave}`;
    if (!g.material) dep.prepararMaterial(m);
    for (const malha of g.malhas) {
      if (!g.originais.has(malha)) g.originais.set(malha, { material: malha.material, geometria: malha.geometry });
      malha.geometry = geometriaComUv(malha);
      malha.material = m;
    }
    g.material = m;
    return m;
  }

  // Aquecimento: um cubo de 1 cm sob o chão com o mesmo tipo de material dos acabamentos. O shader é compilado já
  // no primeiro quadro, e a primeira troca (como todas) só muda números e textura: fica bem abaixo de 200 ms.
  const materialAquecimento = new THREE.MeshStandardMaterial({ map: branca });
  dep.prepararMaterial(materialAquecimento);
  const aquecimento = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), materialAquecimento);
  aquecimento.position.set(0, -5, 0);
  aquecimento.frustumCulled = false;
  cena.add(aquecimento);

  const moveis = new Map<string, THREE.Object3D>();
  const materiaisMoveis = new Set<THREE.Material>();
  const grupoMoveis = new THREE.Group();
  grupoMoveis.name = 'moveis';
  cena.add(grupoMoveis);

  function montarPadrao(chave: string): THREE.Object3D {
    const def = movelPadrao(chave);
    if (!def) throw new Error(`móvel padrão inexistente: ${chave}`);
    const raiz = new THREE.Group();
    for (const p of def.pecas) {
      const geo = p.forma === 'caixa' ? new THREE.BoxGeometry(...p.tamanho) : new THREE.CylinderGeometry(p.tamanho[0] / 2, p.tamanho[0] / 2, p.tamanho[1], 24);
      const m = new THREE.MeshStandardMaterial({ color: p.cor, roughness: p.rugosidade ?? 0.8 });
      dep.prepararMaterial(m);
      materiaisMoveis.add(m);
      const malha = new THREE.Mesh(geo, m);
      malha.position.set(...p.posicao);
      malha.castShadow = true;
      malha.receiveShadow = true;
      raiz.add(malha);
    }
    return raiz;
  }

  async function montarArquivo(url: string): Promise<THREE.Object3D> {
    const obj = await dep.carregarGltf(url);
    // base no chão e centro em (0, 0): a pose diz onde fica
    const caixa = new THREE.Box3().setFromObject(obj);
    const centro = caixa.getCenter(new THREE.Vector3());
    obj.position.set(-centro.x, -caixa.min.y, -centro.z);
    const raiz = new THREE.Group();
    raiz.add(obj);
    obj.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        dep.prepararMaterial(m);
        materiaisMoveis.add(m);
      }
    });
    return raiz;
  }

  function aplicarPose(obj: THREE.Object3D, p: PoseMovel) {
    obj.position.set(p.x, p.y, p.z);
    obj.rotation.set(0, THREE.MathUtils.degToRad(p.giroGraus), 0);
  }

  return {
    /**
     * Adianta o trabalho da troca (fora da interação): UV de todas as peças personalizáveis e as texturas dos
     * acabamentos do catálogo. Devolve as texturas novas, para o viewer enviar à placa de vídeo.
     */
    preparar(acabamentos: readonly Acabamento[]): THREE.Texture[] {
      for (const g of grupos.values())
        for (const malha of g.malhas) {
          if (g.originais.has(malha)) continue;
          const geo = geometriaComUv(malha);
          // peça sem textura própria: já passa a usar a geometria com UV (mesma forma e normais planas, mesmo
          // visual), e a placa de vídeo a recebe no próximo quadro, antes de qualquer troca
          const mats = Array.isArray(malha.material) ? malha.material : [malha.material];
          if (mats.every((m) => !(m as THREE.MeshStandardMaterial).map)) {
            g.originais.set(malha, { material: malha.material, geometria: malha.geometry });
            malha.geometry = geo;
          }
        }
      const novas: THREE.Texture[] = [];
      for (const a of acabamentos) {
        const antes = texturas.size;
        const t = textura(a);
        if (texturas.size > antes) novas.push(t);
      }
      return novas;
    },
    superficies(): Superficie[] {
      return ordenarGrupos(
        [...grupos.values()].map((g) => ({ chave: g.def.chave, rotulo: g.def.rotulo, categoria: g.def.categoria, areaM2: Math.round(g.area * 100) / 100, pecas: g.malhas.length })),
      );
    },
    /** Troca o acabamento de uma superfície (`null` volta ao original). Devolve `false` se a superfície não existe. */
    definirAcabamento(chave: string, a: Acabamento | null): boolean {
      const g = grupos.get(chave);
      if (!g) return false;
      if (!a) {
        // volta ao material original; o do grupo fica guardado (trocar de novo não cria nem compila nada)
        for (const [malha, o] of g.originais) {
          malha.material = o.material;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          if (mats.some((x) => (x as THREE.MeshStandardMaterial).map)) malha.geometry = o.geometria;
        }
        return true;
      }
      const m = prepararGrupo(g);
      const t = textura(a);
      if (m.map !== t) m.map = t;
      if (t !== branca) t.repeat.set(1 / a.escalaM, 1 / a.escalaM);
      // no liso a cor vai inteira no material; nos padrões ela já está desenhada na textura
      m.color.set(a.padrao === 'liso' ? a.cor : '#ffffff');
      m.roughness = a.rugosidade;
      m.metalness = a.metalico;
      return true;
    },
    async colocarMovel(id: string, fonte: FonteMovel, pose: PoseMovel): Promise<void> {
      const anterior = moveis.get(id);
      if (anterior) {
        aplicarPose(anterior, pose);
        return;
      }
      const obj = 'padrao' in fonte ? montarPadrao(fonte.padrao) : await montarArquivo(fonte.url);
      obj.name = `movel:${id}`;
      obj.userData.movelId = id;
      aplicarPose(obj, pose);
      moveis.set(id, obj);
      grupoMoveis.add(obj);
    },
    moverMovel(id: string, pose: PoseMovel): boolean {
      const obj = moveis.get(id);
      if (!obj) return false;
      aplicarPose(obj, pose);
      return true;
    },
    removerMovel(id: string): boolean {
      const obj = moveis.get(id);
      if (!obj) return false;
      grupoMoveis.remove(obj);
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      moveis.delete(id);
      return true;
    },
    /** Móvel sob o clique (para selecionar arrastando o dedo/mouse). */
    movelDoObjeto(o: THREE.Object3D | null): string | null {
      for (let x = o; x; x = x.parent) if (typeof x.userData.movelId === 'string') return x.userData.movelId as string;
      return null;
    },
    objetosMoveis(): THREE.Object3D[] {
      return [...moveis.values()];
    },
    destruir() {
      for (const t of texturas.values()) t.dispose();
      for (const geo of comUv.values()) geo.dispose();
      branca.dispose();
      for (const g of grupos.values()) g.material?.dispose();
      for (const m of materiaisMoveis) m.dispose();
      cena.remove(grupoMoveis);
      cena.remove(aquecimento);
      aquecimento.geometry.dispose();
      materialAquecimento.dispose();
    },
  };
}

export type Configurador = ReturnType<typeof criarConfigurador>;
