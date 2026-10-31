import { describe, it, expect } from 'vitest';
import { pode, type Acao, type Papel } from './rbac';

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
