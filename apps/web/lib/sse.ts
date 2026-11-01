/** Evento de um fluxo SSE (`event:` + `data:` em JSON). */
export interface EventoSse {
  evento: string;
  dados: unknown;
}

/**
 * Lê um fluxo SSE de um `fetch` (POST: o EventSource só faz GET) e chama `aoEvento` a cada evento completo.
 * Os pedaços da rede podem cortar um evento ao meio: guarda o resto até chegar o fim (linha em branco).
 */
export async function lerEventos(corpo: ReadableStream<Uint8Array>, aoEvento: (e: EventoSse) => void): Promise<void> {
  const leitor = corpo.getReader();
  // stream: true guarda o byte de um acento partido entre dois pedaços até o resto chegar
  const decodificador = new TextDecoder();
  let resto = '';
  for (;;) {
    const { value, done } = await leitor.read();
    resto += value ? decodificador.decode(value, { stream: true }) : decodificador.decode();
    const blocos = resto.split('\n\n');
    resto = done ? '' : blocos.pop()!;
    for (const bloco of blocos) {
      let evento = 'message';
      const dados: string[] = [];
      for (const linha of bloco.split('\n')) {
        if (linha.startsWith('event:')) evento = linha.slice(6).trim();
        else if (linha.startsWith('data:')) dados.push(linha.slice(5).trimStart());
      }
      if (!dados.length) continue;
      let json: unknown;
      try {
        json = JSON.parse(dados.join('\n'));
      } catch {
        continue; // dado que não é JSON: ignora (o servidor só manda JSON)
      }
      aoEvento({ evento, dados: json }); // erro de quem recebe sobe (ex.: evento `erro` vira exceção na tela)
    }
    if (done) return;
  }
}
