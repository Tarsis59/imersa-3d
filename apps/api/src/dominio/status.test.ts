import { describe, it, expect } from 'vitest';
import { validarTransicao, transicoesPermitidas, type StatusUnidade } from './status';
import type { Papel } from '../auth/rbac';

describe('transições de status', () => {
  it.each([
    ['admin', 'disponivel', 'reservado', undefined, 'ok'],
    ['admin', 'disponivel', 'vendido', undefined, 'ok'],
    ['admin', 'reservado', 'vendido', undefined, 'ok'],
    ['admin', 'disponivel', 'bloqueado', undefined, 'ok'],
    ['admin', 'bloqueado', 'disponivel', undefined, 'ok'],
    ['admin', 'vendido', 'disponivel', 'distrato assinado', 'ok'],
    ['admin', 'vendido', 'disponivel', '  ', 'motivo_obrigatorio'],
    ['admin', 'vendido', 'reservado', undefined, 'transicao_invalida'],
    ['admin', 'bloqueado', 'vendido', undefined, 'transicao_invalida'],
    ['admin', 'disponivel', 'disponivel', undefined, 'transicao_invalida'],
    ['consultora', 'disponivel', 'reservado', undefined, 'ok'],
    ['consultora', 'reservado', 'disponivel', undefined, 'ok'],
    ['consultora', 'reservado', 'vendido', undefined, 'sem_permissao'],
    ['consultora', 'disponivel', 'bloqueado', undefined, 'sem_permissao'],
    ['viewer', 'disponivel', 'reservado', undefined, 'sem_permissao'],
    ['produtor', 'disponivel', 'reservado', undefined, 'sem_permissao'],
  ] as Array<[Papel, StatusUnidade, StatusUnidade, string | undefined, string]>)('%s: %s → %s (%s) = %s', (papel, de, para, motivo, esperado) => {
    const r = validarTransicao(papel, de, para, motivo);
    expect(r.ok ? 'ok' : r.erro).toBe(esperado);
  });

  it('lista o que cada papel pode fazer a partir de um status', () => {
    expect(transicoesPermitidas('admin', 'disponivel')).toEqual(['reservado', 'vendido', 'bloqueado']);
    expect(transicoesPermitidas('consultora', 'disponivel')).toEqual(['reservado']);
    expect(transicoesPermitidas('consultora', 'vendido')).toEqual([]);
    expect(transicoesPermitidas('viewer', 'disponivel')).toEqual([]);
  });
});
