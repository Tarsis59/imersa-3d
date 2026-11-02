export interface NivelQualidade {
  nome: 'alto' | 'medio' | 'baixo';
  pixelRatioMax: number;
  sombras: boolean;
  tamanhoSombra: number;
  /** Sombra de contato, brilho suave e antisserrilhado de pós-processamento (só onde sobra placa de vídeo). */
  posProcessamento: boolean;
}

/** Do mais bonito ao mais leve. */
export const NIVEIS: readonly NivelQualidade[] = [
  { nome: 'alto', pixelRatioMax: 2, sombras: true, tamanhoSombra: 2048, posProcessamento: true },
  { nome: 'medio', pixelRatioMax: 1.5, sombras: true, tamanhoSombra: 1024, posProcessamento: false },
  { nome: 'baixo', pixelRatioMax: 1, sombras: false, tamanhoSombra: 0, posProcessamento: false },
];

export interface OpcoesQualidade {
  /** Índice em NIVEIS para começar. */
  inicial?: number;
  /** Abaixo disso (média da janela), desce um nível. */
  minimoFps?: number;
  /** Acima disso por `sustentarMs`, sobe um nível. */
  folgaFps?: number;
  janelaMs?: number;
  sustentarMs?: number;
  /** Tempo mínimo entre trocas (e no início, enquanto carrega). */
  esperaMs?: number;
  /** Quadro mais longo que isso é ignorado (aba em segundo plano, travada pontual). */
  quadroMaxMs?: number;
  /** Só mede, nunca troca de nível (testes visuais, comparação entre aparelhos). */
  fixo?: boolean;
}

/** Mede o FPS e decide o nível de qualidade, com histerese para não ficar trocando. */
export class QualidadeAdaptativa {
  private indice: number;
  private readonly o: Required<Omit<OpcoesQualidade, 'inicial'>>;
  private janela: number[] = [];
  private soma = 0;
  private desdeTroca = 0;
  private acimaMs = 0;
  /** Quadros longos seguidos (aparelho que não dá conta, não aba em segundo plano). */
  private longos = 0;
  /** Tempo de desenho a ignorar (carga pontual conhecida: cidade montando, materiais compilando). */
  private ignorarMs = 0;

  constructor(opcoes: OpcoesQualidade = {}) {
    this.indice = Math.min(Math.max(opcoes.inicial ?? 0, 0), NIVEIS.length - 1);
    this.o = {
      minimoFps: opcoes.minimoFps ?? 30,
      folgaFps: opcoes.folgaFps ?? 50,
      janelaMs: opcoes.janelaMs ?? 2_000,
      sustentarMs: opcoes.sustentarMs ?? 5_000,
      esperaMs: opcoes.esperaMs ?? 3_000,
      quadroMaxMs: opcoes.quadroMaxMs ?? 250,
      fixo: opcoes.fixo ?? false,
    };
  }

  get nivel(): NivelQualidade {
    return NIVEIS[this.indice]!;
  }

  /** Média de FPS na janela atual (0 antes do primeiro quadro). */
  get fps(): number {
    return this.soma > 0 ? (this.janela.length * 1000) / this.soma : 0;
  }

  pixelRatio(dispositivo: number): number {
    return Math.min(dispositivo, this.nivel.pixelRatioMax);
  }

  /**
   * Não mede os próximos `ms` de desenho: a carga pontual (a cidade de mil prédios montando, os materiais
   * compilando no 1º quadro) não é o aparelho sem força e não deve derrubar a qualidade para sempre.
   */
  ignorarCarga(ms: number): void {
    this.ignorarMs = Math.max(this.ignorarMs, ms);
    this.longos = 0;
  }

  /** Registra a duração de um quadro. Devolve o novo nível quando troca; senão `null`. */
  registrar(dtMs: number): NivelQualidade | null {
    if (!(dtMs > 0)) return null;
    if (this.ignorarMs > 0) {
      this.ignorarMs -= Math.min(dtMs, 1000);
      return null;
    }
    if (dtMs > this.o.quadroMaxMs) {
      // um quadro longo sozinho é travada ou a volta de uma aba escondida (que não desenha nada enquanto escondida);
      // vários seguidos, de qualquer tamanho, é o aparelho que não dá conta: desce um nível na hora. Sem teto: no
      // desenho por software, com o acabamento de imagem, um quadro passa de 5 s e travava a página inteira
      if (this.o.fixo) return null;
      this.longos++;
      if (this.longos >= 3 && this.indice < NIVEIS.length - 1) return this.trocar(this.indice + 1);
      return null;
    }
    this.longos = 0;
    this.janela.push(dtMs);
    this.soma += dtMs;
    while (this.janela.length > 1 && this.soma - this.janela[0]! >= this.o.janelaMs) this.soma -= this.janela.shift()!;
    this.desdeTroca += dtMs;
    if (this.soma < this.o.janelaMs) return null;

    if (this.o.fixo) return null;
    const fps = this.fps;
    this.acimaMs = fps > this.o.folgaFps ? this.acimaMs + dtMs : 0;
    if (this.desdeTroca < this.o.esperaMs) return null;
    if (fps < this.o.minimoFps && this.indice < NIVEIS.length - 1) return this.trocar(this.indice + 1);
    if (this.acimaMs >= this.o.sustentarMs && this.indice > 0) return this.trocar(this.indice - 1);
    return null;
  }

  private trocar(indice: number): NivelQualidade {
    this.indice = indice;
    this.janela = [];
    this.soma = 0;
    this.desdeTroca = 0;
    this.acimaMs = 0;
    this.longos = 0;
    return this.nivel;
  }
}
