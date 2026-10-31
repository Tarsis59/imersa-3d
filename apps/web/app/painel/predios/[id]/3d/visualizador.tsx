'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as THREE from 'three';
import { criarCarregadorGltf } from '@imersa/viewer';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Aviso, Botao, Cartao, Selecao } from '@/components/ui';
import { DECODIFICADORES } from '@/lib/decodificadores';
import { ROTULO_STATUS, type StatusUnidade } from '@/lib/tipos';

export interface UnidadeVinculo {
  id: string;
  codigo: string;
  andar: string;
  status: StatusUnidade;
  meshNodeId: string | null;
}

/** Mesmas cores do espelho de vendas. */
const COR_3D: Record<StatusUnidade, number> = { disponivel: 0x059669, reservado: 0xfbbf24, vendido: 0xdc2626, bloqueado: 0x64748b };

export function Visualizador3D({
  modeloId,
  urlModelo,
  unidades,
  podeEditar,
  vincular,
}: {
  /** Identidade estável do modelo: o link assinado muda a cada atualização da página, o arquivo não. */
  modeloId: string;
  urlModelo: string;
  unidades: UnidadeVinculo[];
  podeEditar: boolean;
  vincular: (unidadeId: string, meshNodeId: string | null) => Promise<{ erro?: string }>;
}) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const urlAtual = useRef(urlModelo);
  urlAtual.current = urlModelo;
  const malhas = useRef(new Map<string, { malha: THREE.Mesh; corOriginal: THREE.Color }>());
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [peca, setPeca] = useState<string | null>(null);
  const [unidadeEscolhida, setUnidadeEscolhida] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  // Cena, câmera, carregamento do GLB e clique (uma vez por modelo).
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const cena = new THREE.Scene();
    cena.background = new THREE.Color(0xe9eef3);
    cena.add(new THREE.HemisphereLight(0xffffff, 0x9aa4ae, 1.4));
    const sol = new THREE.DirectionalLight(0xffffff, 1.4);
    sol.position.set(30, 50, 20);
    cena.add(sol);
    const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.1, 5000);
    const controles = new OrbitControls(camera, renderer.domElement);
    controles.enableDamping = true;
    let ativo = true;

    // GLB comprimido (Meshopt/Draco/KTX2) também abre
    const { carregador, liberar } = criarCarregadorGltf(renderer, DECODIFICADORES);
    carregador.load(
      urlAtual.current,
      (gltf) => {
        if (!ativo) return;
        const modelo = gltf.scene;
        const caixa = new THREE.Box3().setFromObject(modelo);
        modelo.position.sub(caixa.getCenter(new THREE.Vector3()));
        const tamanho = caixa.getSize(new THREE.Vector3()).length();
        camera.position.set(tamanho * 0.7, tamanho * 0.55, tamanho * 0.7);
        camera.far = tamanho * 20;
        camera.updateProjectionMatrix();
        modelo.traverse((o) => {
          if (o instanceof THREE.Mesh && o.name) {
            // Material próprio por peça: pintar uma não pinta as outras.
            const material = (Array.isArray(o.material) ? o.material[0] : o.material).clone() as THREE.MeshStandardMaterial;
            o.material = material;
            malhas.current.set(o.name, { malha: o, corOriginal: material.color.clone() });
          }
        });
        cena.add(modelo);
        setEstado('pronto');
      },
      undefined,
      () => ativo && setEstado('erro'),
    );

    const raycaster = new THREE.Raycaster();
    let inicio = { x: 0, y: 0 };
    const aoApertar = (e: PointerEvent) => (inicio = { x: e.clientX, y: e.clientY });
    const aoSoltar = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 5) return; // foi arrasto, não clique
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const alvo = raycaster.intersectObjects([...malhas.current.values()].map((m) => m.malha), false)[0];
      setPeca(alvo ? alvo.object.name : null);
    };
    renderer.domElement.addEventListener('pointerdown', aoApertar);
    renderer.domElement.addEventListener('pointerup', aoSoltar);
    const aoRedimensionar = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener('resize', aoRedimensionar);
    renderer.setAnimationLoop(() => {
      controles.update();
      renderer.render(cena, camera);
    });
    return () => {
      ativo = false;
      liberar();
      window.removeEventListener('resize', aoRedimensionar);
      renderer.setAnimationLoop(null);
      controles.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      malhas.current.clear();
    };
  }, [modeloId]);

  // Cores: peça ligada = cor do status da unidade; selecionada = destaque azul.
  useEffect(() => {
    if (estado !== 'pronto') return;
    const porNo = new Map(unidades.filter((u) => u.meshNodeId).map((u) => [u.meshNodeId!, u]));
    for (const [nome, { malha, corOriginal }] of malhas.current) {
      const m = malha.material as THREE.MeshStandardMaterial;
      const u = porNo.get(nome);
      m.color.copy(u ? new THREE.Color(COR_3D[u.status]) : corOriginal);
      m.emissive?.setHex(nome === peca ? 0x0369a1 : 0x000000);
    }
  }, [estado, unidades, peca]);

  const ligada = peca ? unidades.find((u) => u.meshNodeId === peca) : undefined;
  const salvar = (unidadeId: string, no: string | null) =>
    iniciar(async () => {
      const r = await vincular(unidadeId, no);
      setErro(r.erro ?? null);
      if (!r.erro) router.refresh();
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
      <div
        ref={container}
        data-testid="visualizador-3d"
        data-estado={estado}
        className="relative h-[60vh] min-h-80 overflow-hidden rounded-2xl border border-borda"
        aria-label="Modelo 3D do prédio. Arraste para girar, role para aproximar, clique numa peça para selecionar."
      >
        {estado === 'carregando' && <p className="absolute inset-0 grid place-items-center text-suave">Carregando modelo…</p>}
        {estado === 'erro' && <p className="absolute inset-0 grid place-items-center text-perigo">Não foi possível carregar o modelo 3D.</p>}
      </div>
      <Cartao titulo="Peça selecionada">
        {!peca ? (
          <p className="text-sm text-suave">Clique numa peça do modelo.</p>
        ) : (
          <div className="grid gap-3">
            <code data-testid="peca-selecionada" className="break-all rounded bg-fundo p-2 text-xs">
              {peca}
            </code>
            {ligada ? (
              <p data-testid="vinculo-atual" className="text-sm">
                Ligada à unidade <strong>{ligada.codigo}</strong> ({ROTULO_STATUS[ligada.status]}).
              </p>
            ) : (
              <p className="text-sm text-suave">Ainda não ligada a nenhuma unidade.</p>
            )}
            {podeEditar && (
              <>
                <Selecao id="unidade-vinculo" rotulo="Unidade" value={unidadeEscolhida} onChange={(e) => setUnidadeEscolhida(e.target.value)}>
                  <option value="">Escolha…</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.codigo} · {u.andar}
                      {u.meshNodeId ? ' (já ligada)' : ''}
                    </option>
                  ))}
                </Selecao>
                <Botao type="button" disabled={!unidadeEscolhida || salvando} onClick={() => salvar(unidadeEscolhida, peca)}>
                  Ligar à unidade
                </Botao>
                {ligada && (
                  <Botao type="button" variante="secundario" disabled={salvando} onClick={() => salvar(ligada.id, null)}>
                    Desligar
                  </Botao>
                )}
              </>
            )}
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
          </div>
        )}
      </Cartao>
    </div>
  );
}
