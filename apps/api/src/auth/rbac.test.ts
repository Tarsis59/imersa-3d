import { describe, it, expect } from 'vitest';
import { pode, exigeMfa, type Acao, type Papel } from './rbac';

const casos: Array<[Papel, Acao, boolean]> = [
  ['super_admin', 'membro:convidar', true],
  ['admin', 'projeto:criar', true],
  ['admin', 'auditoria:ler', true],
  ['admin', 'empreendimento:editar', true],
  ['admin', 'importacao:executar', true],
  ['admin', 'unidade:status', true],
  ['consultora', 'projeto:ler', true],
  ['consultora', 'unidade:status', true],
  ['consultora', 'projeto:criar', false],
  ['consultora', 'empreendimento:editar', false],
  ['consultora', 'importacao:executar', false],
  ['consultora', 'auditoria:ler', false],
  ['produtor', 'projeto:criar', false],
  ['produtor', 'unidade:status', false],
  ['viewer', 'projeto:ler', true],
  ['viewer', 'unidade:status', false],
  ['viewer', 'membro:convidar', false],
  ['consultora', 'link:criar', true],
  ['consultora', 'lead:ler', true],
  ['consultora', 'numeros:ler', true],
  ['produtor', 'link:criar', false],
  ['viewer', 'link:criar', false],
  ['viewer', 'lead:ler', false],
  ['viewer', 'numeros:ler', false],
  ['admin', 'integracao:gerir', true],
  ['consultora', 'integracao:gerir', false],
  ['admin', 'catalogo:editar', true],
  ['consultora', 'catalogo:editar', false],
  ['consultora', 'configuracao:salvar', true],
  ['produtor', 'configuracao:salvar', false],
  ['viewer', 'configuracao:salvar', false],
];

describe('RBAC', () => {
  it.each(casos)('%s em %s → %s', (papel, acao, esperado) => expect(pode(papel, acao)).toBe(esperado));
});

describe('MFA obrigatório', () => {
  it.each([
    ['admin', 'projeto:criar', true],
    ['admin', 'membro:convidar', true],
    ['admin', 'empreendimento:editar', true],
    ['admin', 'importacao:executar', true],
    ['admin', 'unidade:status', true],
    ['super_admin', 'auditoria:ler', true],
    ['admin', 'projeto:ler', false],
    ['consultora', 'projeto:ler', false],
    ['consultora', 'unidade:status', false],
    ['admin', 'lead:ler', true],
    ['consultora', 'lead:ler', false],
    ['admin', 'link:criar', false],
    ['admin', 'integracao:gerir', true],
    ['admin', 'catalogo:editar', true],
    ['admin', 'configuracao:salvar', false],
  ] as Array<[Papel, Acao, boolean]>)('%s em %s → %s', (papel, acao, esperado) => expect(exigeMfa(papel, acao)).toBe(esperado));
});
