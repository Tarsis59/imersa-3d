/**
 * Visita em grupo (Plano 11d, item 18), lado do navegador: entra na sala do link, mostra quem está junto (com o
 * boneco de cada um no 3D) e liga a voz entre todos por WebRTC (direto entre os aparelhos; servidor STUN público e
 * grátis; atrás de rede muito fechada pode não conectar, o que pede um servidor TURN pago, ver o plano).
 */
export interface PessoaNaSala {
  id: string;
  nome: string;
  pos: { x: number; y: number; z: number; yaw: number; boneco: string } | null;
  voz: 'sem' | 'conectando' | 'conectada';
}

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export class SalaDeVisita {
  eu: string | null = null;
  private fonte: EventSource | null = null;
  private readonly pessoas = new Map<string, PessoaNaSala>();
  private readonly pares = new Map<string, RTCPeerConnection>();
  private readonly audios = new Map<string, HTMLAudioElement>();
  private microfone: MediaStream | null = null;

  constructor(
    private readonly url: string,
    private readonly nome: string,
    private readonly aoMudar: (pessoas: PessoaNaSala[], estado: 'conectando' | 'na_sala' | 'cheia' | 'fora') => void,
  ) {}

  entrar(): void {
    const f = new EventSource(`${this.url}?nome=${encodeURIComponent(this.nome)}`);
    this.fonte = f;
    this.avisar('conectando');
    const dados = (e: MessageEvent) => JSON.parse(e.data) as { de?: string; id?: string; dados?: Record<string, unknown> };
    f.addEventListener('eu', (e) => {
      this.eu = dados(e as MessageEvent).id ?? null;
      this.avisar('na_sala');
    });
    f.addEventListener('entrou', (e) => {
      const d = dados(e as MessageEvent);
      if (!d.de) return;
      this.pessoas.set(d.de, { id: d.de, nome: String(d.dados?.nome ?? 'Visitante').slice(0, 40), pos: null, voz: 'sem' });
      // quem chega fica sabendo de mim pela próxima posição; com a voz ligada, já chamo
      if (this.microfone) void this.chamar(d.de);
      this.avisar('na_sala');
    });
    f.addEventListener('saiu', (e) => {
      const d = dados(e as MessageEvent);
      if (d.de) this.esquecer(d.de);
      this.avisar('na_sala');
    });
    f.addEventListener('posicao', (e) => {
      const d = dados(e as MessageEvent);
      if (!d.de || !d.dados) return;
      const p = this.pessoas.get(d.de) ?? { id: d.de, nome: 'Visitante', pos: null, voz: 'sem' as const };
      const q = d.dados as { nome?: string; x?: number; y?: number; z?: number; yaw?: number; boneco?: string };
      p.nome = String(q.nome ?? p.nome).slice(0, 40);
      p.pos = [q.x, q.y, q.z, q.yaw].every((v) => typeof v === 'number' && Number.isFinite(v)) ? { x: q.x!, y: q.y!, z: q.z!, yaw: q.yaw!, boneco: String(q.boneco ?? 'ana') } : null;
      this.pessoas.set(d.de, p);
      this.avisar('na_sala');
    });
    f.addEventListener('oferta', (e) => void this.aoOferta(dados(e as MessageEvent)));
    f.addEventListener('resposta', (e) => {
      const d = dados(e as MessageEvent);
      if (d.de) void this.pares.get(d.de)?.setRemoteDescription(d.dados as unknown as RTCSessionDescriptionInit).catch(() => undefined);
    });
    f.addEventListener('ice', (e) => {
      const d = dados(e as MessageEvent);
      if (d.de && d.dados) void this.pares.get(d.de)?.addIceCandidate(d.dados as RTCIceCandidateInit).catch(() => undefined);
    });
    f.onerror = () => {
      if (f.readyState === EventSource.CLOSED) this.avisar('cheia');
    };
  }

  /** Manda a minha posição a pé (o boneco dos outros me segue). */
  posicao(p: { x: number; y: number; z: number; yaw: number; boneco: string } | null): void {
    if (!this.eu) return;
    void this.sinal(null, 'posicao', { nome: this.nome, ...(p ?? {}) });
  }

  async ligarVoz(): Promise<boolean> {
    if (this.microfone) return true;
    try {
      this.microfone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return false;
    }
    for (const id of this.pessoas.keys()) await this.chamar(id);
    return true;
  }

  desligarVoz(): void {
    for (const t of this.microfone?.getTracks() ?? []) t.stop();
    this.microfone = null;
    for (const id of [...this.pares.keys()]) this.fecharPar(id);
    this.avisar('na_sala');
  }

  sair(): void {
    this.desligarVoz();
    this.fonte?.close();
    this.fonte = null;
    this.pessoas.clear();
    this.avisar('fora');
  }

  get comVoz(): boolean {
    return this.microfone !== null;
  }

  private async sinal(para: string | null, tipo: 'posicao' | 'oferta' | 'resposta' | 'ice', dados: unknown): Promise<void> {
    if (!this.eu) return;
    await fetch(`${this.url}/sinal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ de: this.eu, para, tipo, dados }) }).catch(() => undefined);
  }

  private par(id: string): RTCPeerConnection {
    let pc = this.pares.get(id);
    if (pc) return pc;
    pc = new RTCPeerConnection(ICE);
    this.pares.set(id, pc);
    for (const t of this.microfone?.getTracks() ?? []) pc.addTrack(t, this.microfone!);
    pc.onicecandidate = (e) => e.candidate && void this.sinal(id, 'ice', e.candidate.toJSON());
    pc.ontrack = (e) => {
      let a = this.audios.get(id);
      if (!a) {
        a = new Audio();
        a.autoplay = true;
        this.audios.set(id, a);
      }
      a.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    };
    pc.onconnectionstatechange = () => {
      const p = this.pessoas.get(id);
      if (p) p.voz = pc!.connectionState === 'connected' ? 'conectada' : ['failed', 'closed', 'disconnected'].includes(pc!.connectionState) ? 'sem' : 'conectando';
      this.avisar('na_sala');
    };
    return pc;
  }

  private async chamar(id: string): Promise<void> {
    const pc = this.par(id);
    const p = this.pessoas.get(id);
    if (p) p.voz = 'conectando';
    const oferta = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(oferta);
    await this.sinal(id, 'oferta', pc.localDescription?.toJSON());
  }

  private async aoOferta(d: { de?: string; dados?: unknown }): Promise<void> {
    if (!d.de || !this.eu) return;
    const pc = this.par(d.de);
    // os dois chamaram ao mesmo tempo: quem tem o id menor mantém a própria chamada
    if (pc.signalingState === 'have-local-offer') {
      if (this.eu < d.de) return;
      await pc.setLocalDescription({ type: 'rollback' }).catch(() => undefined);
    }
    await pc.setRemoteDescription(d.dados as RTCSessionDescriptionInit);
    const resposta = await pc.createAnswer();
    await pc.setLocalDescription(resposta);
    await this.sinal(d.de, 'resposta', pc.localDescription?.toJSON());
  }

  private fecharPar(id: string): void {
    this.pares.get(id)?.close();
    this.pares.delete(id);
    const a = this.audios.get(id);
    if (a) a.srcObject = null;
    this.audios.delete(id);
    const p = this.pessoas.get(id);
    if (p) p.voz = 'sem';
  }

  private esquecer(id: string): void {
    this.fecharPar(id);
    this.pessoas.delete(id);
  }

  private avisar(estado: 'conectando' | 'na_sala' | 'cheia' | 'fora'): void {
    this.aoMudar([...this.pessoas.values()].map((p) => ({ ...p })), estado);
  }
}
