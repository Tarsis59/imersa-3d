import { describe, it, expect } from 'vitest';
import { pode, exigeMfa, type Acao, type Papel } from './rbac';

const casos: Array<[Papel, Acao, boolean]> = [
  ['super_admin', 'membro:convidar', true],
  ['admin', 'projeto:criar', true],
  ['admin', 'auditoria:ler', true],
  ['consultora', 'projeto:ler', true],
  ['consultora', 'projeto:criar', false],
  ['consultora', 'auditoria:ler', false],
  ['produtor', 'projeto:criar', false],
  ['viewer', 'projeto:ler', true],
  ['viewer', 'membro:convidar', false],
];

describe('RBAC', () => {
  it.each(casos)('%s em %s → %s', (papel, acao, esperado) => expect(pode(papel, acao)).toBe(esperado));
});

describe('MFA obrigatório', () => {
  it.each([
    ['admin', 'projeto:criar', true],
    ['admin', 'membro:convidar', true],
    ['super_admin', 'auditoria:ler', true],
    ['admin', 'projeto:ler', false],
    ['consultora', 'projeto:ler', false],
  ] as Array<[Papel, Acao, boolean]>)('%s em %s → %s', (papel, acao, esperado) => expect(exigeMfa(papel, acao)).toBe(esperado));
});
