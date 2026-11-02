import { describe, expect, it } from 'vitest';
import { lerPedidosGestao } from './gestao-por-texto';

describe('pedidos por texto da gestão', () => {
  it.each([
    ['a 302 foi vendida', [{ tipo: 'status', codigo: '302', status: 'vendido' }]],
    ['reserva a 404', [{ tipo: 'status', codigo: '404', status: 'reservado' }]],
    ['a 501 voltou a ficar disponível', [{ tipo: 'status', codigo: '501', status: 'disponivel' }]],
    ['bloqueia a 101', [{ tipo: 'status', codigo: '101', status: 'bloqueado' }]],
    ['a 1201 custa 850 mil', [{ tipo: 'preco', codigo: '1201', preco: 850_000 }]],
    ['preço da 302 para R$ 700.000', [{ tipo: 'preco', codigo: '302', preco: 700_000 }]],
    ['o 5º andar agora tem 6 unidades', [{ tipo: 'unidades_no_andar', andar: 5, quantidade: 6 }]],
    ['vídeo de 15 s para o Instagram com voz masculina', [{ tipo: 'video', formato: '9:16', voz: 'pm_alex', duracaoPedida: 15 }]],
    ['um vídeo para o YouTube, sem narração', [{ tipo: 'video', formato: '16:9', voz: null, duracaoPedida: null }]],
    ['foto do pôr do sol da 1201', [{ tipo: 'foto', codigo: '1201', hora: 18 }]],
    ['a 302 foi vendida e a 303 reservada', [{ tipo: 'status', codigo: '302', status: 'vendido' }, { tipo: 'status', codigo: '303', status: 'reservado' }]],
  ])('%s', (texto, esperado) => expect(lerPedidosGestao(texto)).toEqual(esperado));

  it('fora do assunto não vira pedido', () => {
    expect(lerPedidosGestao('bom dia, tudo bem?')).toEqual([]);
  });
});
