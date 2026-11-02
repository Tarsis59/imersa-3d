import { describe, expect, it } from 'vitest';
import { interpretarComando, numeros, type AcaoComando } from './comandos';

/** 50 comandos do jeito que o cliente fala ou digita (aceite do item 20: todos executados certo). */
const CASOS: Array<[string, AcaoComando[]]> = [
  ['mostre as de 3 quartos com sol da manhã até 900 mil', [{ tipo: 'filtro', quartos: [3], precoMax: 900_000, sol: ['manha'] }]],
  ['vá para a piscina', [{ tipo: 'lazer', categoria: 'piscina', nome: 'Piscina' }]],
  ['mostre à noite', [{ tipo: 'hora', hora: 21 }]],
  ['2 quartos', [{ tipo: 'filtro', quartos: [2] }]],
  ['quero ver os de dois ou três quartos', [{ tipo: 'filtro', quartos: [2, 3] }]],
  ['apartamentos de 1 a 3 quartos', [{ tipo: 'filtro', quartos: [1, 2, 3] }]],
  ['studios até 400 mil', [{ tipo: 'filtro', quartos: [0], precoMax: 400_000 }]],
  ['até R$ 1,2 milhão', [{ tipo: 'filtro', precoMax: 1_200_000 }]],
  ['no máximo 750.000', [{ tipo: 'filtro', precoMax: 750_000 }]],
  ['com mais de 80 m²', [{ tipo: 'filtro', areaMin: 80 }]],
  ['3 quartos com pelo menos 90 metros', [{ tipo: 'filtro', quartos: [3], areaMin: 90 }]],
  ['só as disponíveis', [{ tipo: 'filtro', status: ['disponivel'] }]],
  ['quais já foram vendidas', [{ tipo: 'filtro', status: ['vendido'] }]],
  ['mostra minhas favoritas', [{ tipo: 'filtro', favoritos: true }]],
  ['sol da tarde', [{ tipo: 'filtro', sol: ['tarde'] }]],
  ['unidades com sol o dia todo', [{ tipo: 'filtro', sol: ['dia-todo'] }]],
  ['quero um apartamento mais fresco, com pouco sol', [{ tipo: 'filtro', sol: ['pouco-sol'] }]],
  ['face nascente com 2 dormitórios', [{ tipo: 'filtro', quartos: [2], sol: ['manha'] }]],
  ['limpar filtros', [{ tipo: 'limpar' }]],
  ['mostra todas', [{ tipo: 'limpar' }]],
  ['me leva para a academia', [{ tipo: 'lazer', categoria: 'academia', nome: 'Academia' }]],
  ['quero ver o salão de festas', [{ tipo: 'lazer', categoria: 'salao_festas', nome: 'Salão de festas' }]],
  ['churrasqueira', [{ tipo: 'lazer', categoria: 'churrasqueira', nome: 'Churrasqueira' }]],
  ['mostra o playground pras crianças', [{ tipo: 'lazer', categoria: 'playground', nome: 'Playground' }]],
  ['vai na sauna', [{ tipo: 'lazer', categoria: null, nome: 'Sauna' }]],
  ['quero conhecer o lazer', [{ tipo: 'tour_lazer' }]],
  ['faz o tour do lazer', [{ tipo: 'tour_lazer' }]],
  ['entra na 302', [{ tipo: 'unidade', codigo: '302', acao: 'entrar' }]],
  ['mostra a unidade 1201', [{ tipo: 'unidade', codigo: '1201', acao: 'mostrar' }]],
  ['qual a vista da 1504', [{ tipo: 'unidade', codigo: '1504', acao: 'vista' }]],
  ['apto A-1203 por dentro', [{ tipo: 'unidade', codigo: 'A-1203', acao: 'entrar' }]],
  ['como fica o pôr do sol', [{ tipo: 'hora', hora: 18 }]],
  ['às 7h', [{ tipo: 'hora', hora: 7 }]],
  ['mostra de manhã', [{ tipo: 'hora', hora: 9 }]],
  ['ao meio-dia no inverno', [{ tipo: 'hora', hora: 12 }, { tipo: 'estacao', estacao: 'inverno' }]],
  ['no verão às 16 horas', [{ tipo: 'hora', hora: 16 }, { tipo: 'estacao', estacao: 'verao' }]],
  ['e se estiver chovendo', [{ tipo: 'clima', clima: 'nublado' }]],
  ['céu limpo', [{ tipo: 'clima', clima: 'limpo' }]],
  ['corta no 5º andar', [{ tipo: 'corte', andar: 5 }]],
  ['mostra até o 10 andar', [{ tipo: 'corte', andar: 10 }]],
  ['tira o corte', [{ tipo: 'corte', andar: null }]],
  ['quero passear a pé', [{ tipo: 'modo', modo: 'primeira-pessoa' }]],
  ['volta para o prédio', [{ tipo: 'visao_geral' }]],
  ['vista de cima', [{ tipo: 'visao_geral' }]],
  ['liga o som', [{ tipo: 'som', ligado: true }]],
  ['desliga o som', [{ tipo: 'som', ligado: false }]],
  ['silêncio', [{ tipo: 'som', ligado: false }]],
  ['3 quartos à noite', [{ tipo: 'filtro', quartos: [3] }, { tipo: 'hora', hora: 21 }]],
  ['dois quartos até novecentos mil disponíveis', [{ tipo: 'filtro', quartos: [2], precoMax: 900_000, status: ['disponivel'] }]],
  ['piscina à noite', [{ tipo: 'lazer', categoria: 'piscina', nome: 'Piscina' }, { tipo: 'hora', hora: 21 }]],
];

describe('comandos da Vitrine (50 frases)', () => {
  it('são 50', () => expect(CASOS).toHaveLength(50));
  it.each(CASOS)('%s', (texto, esperado) => {
    expect(interpretarComando(texto).acoes).toEqual(esperado);
  });

  it('o resumo diz o que foi entendido', () => {
    expect(interpretarComando('mostre as de 3 quartos com sol da manhã até 900 mil').resumo).toBe('3 quartos · sol da manhã · até R$ 900 mil');
    expect(interpretarComando('entra na 302').resumo).toBe('entrar na 302');
  });

  it('frase fora do assunto não vira ação', () => {
    expect(interpretarComando('qual o melhor time do Brasil').acoes).toEqual([]);
    expect(interpretarComando('').acoes).toEqual([]);
    expect(interpretarComando('   ').acoes).toEqual([]);
  });

  it('hora falada: "10 da manhã", "3 da tarde", "8 da noite", "meia-noite" não confunde', () => {
    const hora = (f: string) => interpretarComando(f).acoes.find((a) => a.tipo === 'hora');
    expect(hora('mostre às 10 da manhã')).toEqual({ tipo: 'hora', hora: 10 });
    expect(hora('como fica às 3 da tarde')).toEqual({ tipo: 'hora', hora: 15 });
    expect(hora('8 da noite')).toEqual({ tipo: 'hora', hora: 20 });
    expect(hora('às 12 da noite')).toEqual({ tipo: 'hora', hora: 0 });
    expect(hora('ao meio dia')).toEqual({ tipo: 'hora', hora: 12 });
    // "de manhã" sozinho continua 9h
    expect(hora('mostre de manhã')).toEqual({ tipo: 'hora', hora: 9 });
  });

  it('números por extenso', () => {
    expect(numeros('vinte e um andares')).toBe('21 andares');
    expect(numeros('novecentos mil')).toBe('900 mil');
  });
});
