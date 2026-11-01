import type Anthropic from '@anthropic-ai/sdk';
import type { ChamarModelo } from './assistente';

/**
 * Assistente simulado (testes no navegador e no CI, sem custo): segue o mesmo caminho do real (ferramentas no
 * servidor, ações na tela, fluxo SSE), com regras fixas no lugar do Claude. Nunca em produção.
 *  - "visita"/"contato"/"falar" → pedir_contato
 *  - senão → buscar_unidades (quartos pedidos, se houver) → mostrar_no_3d → resposta com códigos e preços reais
 */
export function chamadaSimulada(): ChamarModelo {
  return async (params, aoTexto) => {
    const msgs = params.messages;
    const ultima = msgs[msgs.length - 1]!;
    const pergunta = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')?.content as string;
    const resultados = Array.isArray(ultima.content) ? (ultima.content as Anthropic.Beta.BetaToolResultBlockParam[]) : [];
    const anterior = msgs[msgs.length - 2];
    const chamadas = anterior && Array.isArray(anterior.content) ? (anterior.content as Anthropic.Beta.BetaContentBlockParam[]).filter((b) => b.type === 'tool_use') : [];
    const ferramenta = (chamadas[0] as Anthropic.Beta.BetaToolUseBlockParam | undefined)?.name;

    let texto = '';
    let usos: Array<{ name: string; input: unknown }> = [];
    if (ultima.role === 'user' && typeof ultima.content === 'string') {
      if (/visita|contato|falar|corretor|consultora/i.test(pergunta)) usos = [{ name: 'pedir_contato', input: { motivo: /visita/i.test(pergunta) ? 'visita' : 'contato', codigo: null } }];
      else {
        const q = pergunta.match(/(\d+)\s*quartos?/i);
        const n = q ? Number(q[1]) : null;
        usos = [{ name: 'buscar_unidades', input: { quartos_min: n, quartos_max: n, area_min_m2: null, area_max_m2: null, preco_max: null, andar_min: null, andar_max: null, situacao: 'disponivel' } }];
      }
    } else if (ferramenta === 'buscar_unidades') {
      const r = JSON.parse(String(resultados[0]?.content ?? '{}')) as { unidades?: Array<{ codigo: string; preco: number | null }> };
      const codigos = (r.unidades ?? []).map((u) => u.codigo);
      if (codigos.length) usos = [{ name: 'mostrar_no_3d', input: { codigos, focar: codigos[0] } }];
      const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      texto = codigos.length
        ? `Encontrei ${codigos.length} unidade${codigos.length > 1 ? 's' : ''}: ${(r.unidades ?? []).map((u) => `${u.codigo}${u.preco !== null ? ` (${reais(u.preco)})` : ''}`).join(', ')}. Destaquei no 3D.`
        : 'Não encontrei unidades disponíveis com isso. Quer que eu procure de outro jeito?';
    } else if (ferramenta === 'pedir_contato') {
      texto = 'Abri o formulário: preencha seu nome e telefone que a consultora fala com você.';
    }
    // depois de mostrar_no_3d a resposta já foi dada: a volta só fecha (como o modelo faz)
    if (texto) aoTexto(texto);
    const content = [
      ...(texto ? [{ type: 'text', text: texto, citations: null }] : []),
      ...usos.map((u, i) => ({ type: 'tool_use', id: `toolu_sim_${msgs.length}_${i}`, name: u.name, input: u.input })),
    ];
    return {
      id: `msg_sim_${msgs.length}`,
      type: 'message',
      role: 'assistant',
      model: 'simulado',
      content,
      stop_reason: usos.length ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Beta.BetaMessage;
  };
}
