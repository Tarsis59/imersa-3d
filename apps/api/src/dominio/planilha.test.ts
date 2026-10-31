import { describe, it, expect } from 'vitest';
import { validarPlanilha } from './planilha';

const CAB = 'predio;andar;codigo;tipologia;area_m2;quartos;suites;vagas;preco;status';

describe('validação da planilha de unidades', () => {
  it('linha completa vira dado tipado', () => {
    const r = validarPlanilha(`${CAB}\nTorre A;1;101;Tipo 2Q;72,5;2;1;1;650.000,00;Disponível`);
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([
      { linha: 2, predio: 'Torre A', andar: 1, codigo: '101', tipologia: 'Tipo 2Q', areaM2: 72.5, quartos: 2, suites: 1, vagas: 1, preco: 650000, status: 'disponivel' },
    ]);
  });

  it('só as colunas obrigatórias bastam; cabeçalho aceita acento e maiúsculas', () => {
    const r = validarPlanilha('Prédio;Andar;Código\nTorre A;0;T01');
    expect(r.erros).toEqual([]);
    expect(r.linhas[0]).toMatchObject({ predio: 'Torre A', andar: 0, codigo: 'T01', tipologia: null, preco: null, status: null });
  });

  it('coluna obrigatória ausente', () => {
    expect(validarPlanilha('predio;codigo\nTorre;1').erros).toEqual([{ linha: 1, campo: 'andar', mensagem: 'coluna obrigatória ausente' }]);
  });

  it('planilha vazia', () => {
    expect(validarPlanilha('predio;andar;codigo').erros[0]?.campo).toBe('arquivo');
  });

  it('aponta cada erro com linha e campo', () => {
    const r = validarPlanilha(
      [
        CAB,
        ';1;101;;;;;;;',
        'Torre A;um;102;;;;;;;',
        'Torre A;1;1 03;;;;;;;',
        'Torre A;1;104;;;;;;-5;',
        'Torre A;1;105;;;;;;;alugado',
        'Torre A;1;106;;80;;;;;',
        'Torre A;1;107;Tipo X;0;;;;;',
        'Torre A;1;108;Tipo Y;50;3,5;;;;',
      ].join('\n'),
    );
    expect(r.erros).toEqual([
      { linha: 2, campo: 'predio', mensagem: 'obrigatório' },
      { linha: 3, campo: 'andar', mensagem: 'deve ser número inteiro' },
      { linha: 4, campo: 'codigo', mensagem: 'use até 20 letras, números ou hífen' },
      { linha: 5, campo: 'preco', mensagem: 'não pode ser negativo' },
      { linha: 6, campo: 'status', mensagem: 'use disponivel, reservado, vendido ou bloqueado' },
      { linha: 7, campo: 'tipologia', mensagem: 'informe a tipologia para usar área, quartos, suítes ou vagas' },
      { linha: 8, campo: 'area_m2', mensagem: 'deve ser maior que zero' },
      { linha: 9, campo: 'quartos', mensagem: 'deve ser número inteiro entre 0 e 50' },
    ]);
  });

  it('unidade repetida e tipologia com valores diferentes', () => {
    const r = validarPlanilha(`${CAB}\nTorre A;1;101;T2;70;2;;;;\nTorre A;2;101;T2;70;2;;;;\nTorre A;3;301;T2;75;2;;;;`);
    expect(r.erros).toEqual([
      { linha: 3, campo: 'codigo', mensagem: 'unidade repetida (já aparece na linha 2)' },
      { linha: 4, campo: 'tipologia', mensagem: 'tipologia "T2" com valores diferentes da linha 2' },
    ]);
  });

  it('limite de linhas', () => {
    const corpo = Array.from({ length: 5001 }, (_, i) => `T;1;${i}`).join('\n');
    expect(validarPlanilha(`predio;andar;codigo\n${corpo}`).erros[0]).toMatchObject({ campo: 'arquivo' });
  });
});
