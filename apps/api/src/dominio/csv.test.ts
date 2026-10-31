import { describe, it, expect } from 'vitest';
import { lerCsv } from './csv';

describe('leitor de CSV', () => {
  it('ponto e vírgula (Excel em português), BOM e CRLF', () => {
    expect(lerCsv('﻿a;b;c\r\n1;2;3\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });
  it('vírgula como separador', () => expect(lerCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]));
  it('aspas com separador, aspas escapadas e quebra de linha dentro', () => {
    expect(lerCsv('a;b\n"x;y";"diz ""oi""\nlinha 2"')).toEqual([
      ['a', 'b'],
      ['x;y', 'diz "oi"\nlinha 2'],
    ]);
  });
  it('ignora linhas vazias', () => expect(lerCsv('a;b\n\n1;2\n;\n')).toEqual([['a', 'b'], ['1', '2']]));
  it('aspas não fechadas é erro', () => expect(() => lerCsv('a;b\n"1;2')).toThrow(/aspas/));
});
