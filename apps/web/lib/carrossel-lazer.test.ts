import { describe, it, expect } from 'vitest';
import { carrosselLazer } from './carrossel-lazer';
import type { ItemLazer } from './tipos';

const item = (p: Partial<ItemLazer> & { id: string; nome: string }): ItemLazer => ({
  categoria: 'outro',
  grupo: 'lazer',
  descricao: null,
  x: 0,
  y: 0,
  z: 0,
  ordem: 0,
  fotos: [],
  ...p,
});

describe('carrossel das áreas comuns em 3D', () => {
  it('mantém a ordem do tour (a ordem em que os itens chegam)', () => {
    const itens = [item({ id: 'piscina', nome: 'Piscina', ordem: 0 }), item({ id: 'salao', nome: 'Salão de festas', ordem: 1 }), item({ id: 'academia', nome: 'Academia', ordem: 2 })];
    const cartoes = carrosselLazer(itens, [], false);
    expect(cartoes.map((c) => c.id)).toEqual(['piscina', 'salao', 'academia']);
  });

  it('acha o splat pelo nome do ponto, sem acento nem diferença de maiúscula', () => {
    const itens = [item({ id: 'salao', nome: 'Salão de Festas' })];
    const cartoes = carrosselLazer(itens, [{ id: 'cap-1', nome: 'salao de festas' }], false);
    expect(cartoes[0]!.acao).toEqual({ tipo: 'splat', interiorId: 'cap-1' });
  });

  it('sem splat com o nome: cai no giro 360° quando o prédio tem', () => {
    const itens = [item({ id: 'rooftop', nome: 'Rooftop' })];
    expect(carrosselLazer(itens, [], true)[0]!.acao).toEqual({ tipo: 'giro360' });
    expect(carrosselLazer(itens, [{ id: 'x', nome: 'Outro ambiente' }], true)[0]!.acao).toEqual({ tipo: 'giro360' });
  });

  it('sem splat e sem giro 360°: voa a câmera até o ponto', () => {
    const itens = [item({ id: 'rooftop', nome: 'Rooftop' })];
    expect(carrosselLazer(itens, [], false)[0]!.acao).toEqual({ tipo: 'voo' });
  });

  it('capa é a 1ª foto da ficha; sem foto nenhuma, null (ícone da categoria)', () => {
    const itens = [item({ id: 'a', nome: 'A', fotos: ['foto-1', 'foto-2'] }), item({ id: 'b', nome: 'B', fotos: [] })];
    const cartoes = carrosselLazer(itens, [], false);
    expect(cartoes[0]!.fotoId).toBe('foto-1');
    expect(cartoes[1]!.fotoId).toBeNull();
  });

  it('leva a categoria adiante (ícone de reserva quando não há foto)', () => {
    const itens = [item({ id: 'a', nome: 'A', categoria: 'piscina' })];
    expect(carrosselLazer(itens, [], false)[0]!.categoria).toBe('piscina');
  });
});
