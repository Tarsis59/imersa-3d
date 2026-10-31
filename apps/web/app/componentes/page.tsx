import { Aviso, Botao, Campo, Cartao, Selecao } from '@/components/ui';

const CORES = ['fundo', 'superficie', 'borda', 'texto', 'suave', 'acento', 'perigo', 'sucesso'] as const;
const CLASSE_COR: Record<(typeof CORES)[number], string> = {
  fundo: 'bg-fundo',
  superficie: 'bg-superficie',
  borda: 'bg-borda',
  texto: 'bg-texto',
  suave: 'bg-suave',
  acento: 'bg-acento',
  perigo: 'bg-perigo',
  sucesso: 'bg-sucesso',
};

export default function Componentes() {
  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">Design system Imersa 3D</h1>
      <p className="text-suave">Tokens claro/escuro seguem a preferência do sistema operacional.</p>
      <Cartao titulo="Cores">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CORES.map((c) => (
            <div key={c} className="grid gap-1 text-sm">
              <div className={`h-12 rounded-lg border border-borda ${CLASSE_COR[c]}`} />
              {c}
            </div>
          ))}
        </div>
      </Cartao>
      <Cartao titulo="Botões">
        <div className="flex flex-wrap gap-3">
          <Botao>Primário</Botao>
          <Botao variante="secundario">Secundário</Botao>
          <Botao variante="perigo">Perigo</Botao>
          <Botao disabled>Desabilitado</Botao>
        </div>
      </Cartao>
      <Cartao titulo="Campos">
        <div className="grid gap-4">
          <Campo id="c1" rotulo="Campo normal" placeholder="Digite…" />
          <Campo id="c2" rotulo="Campo com erro" erro="Mensagem de erro" defaultValue="valor" />
          <Selecao id="c3" rotulo="Seleção">
            <option>Opção 1</option>
            <option>Opção 2</option>
          </Selecao>
        </div>
      </Cartao>
      <Cartao titulo="Avisos">
        <div className="grid gap-3">
          <Aviso>Informação</Aviso>
          <Aviso tipo="sucesso">Sucesso</Aviso>
          <Aviso tipo="erro">Erro</Aviso>
        </div>
      </Cartao>
    </main>
  );
}
