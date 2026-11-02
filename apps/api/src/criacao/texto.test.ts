import { describe, expect, it } from 'vitest';
import { interpretarDescricao, numerosPorExtenso, normalizar } from './texto';

describe('números por extenso', () => {
  it('junta as partes e deixa "2 e 3" em paz', () => {
    expect(numerosPorExtenso('vinte e dois andares')).toBe('22 andares');
    expect(numerosPorExtenso('cento e vinte e cinco unidades')).toBe('125 unidades');
    expect(numerosPorExtenso('doze andares, quatro por andar')).toBe('12 andares, 4 por andar');
    expect(numerosPorExtenso('dois e tres quartos')).toBe('2 e 3 quartos');
    expect(numerosPorExtenso('2 e 3 quartos')).toBe('2 e 3 quartos');
    expect(numerosPorExtenso(normalizar('Três torres.'))).toBe('3 torres.');
  });
});

/**
 * 30 descrições do jeito que as incorporadoras escrevem (anúncio, memorial, conversa de WhatsApp). O aceite do item 3:
 * nenhum número errado. O que o texto não diz fica null.
 */
const CASOS: Array<[string, Partial<ReturnType<typeof interpretarDescricao>> & { quartos?: number[]; areas?: Array<number | null>; lazerCat?: string[] }]> = [
  [
    'Residencial Aurora, com 12 andares, 4 apartamentos por andar, 2 e 3 quartos, piscina e academia, na Rua das Flores, 120, Batel, Curitiba/PR.',
    { nome: 'Residencial Aurora', andares: 12, unidadesPorAndar: 4, quartos: [2, 3], lazerCat: ['piscina', 'academia'], endereco: 'Rua das Flores, 120', bairro: 'Batel', cidade: 'Curitiba', uf: 'PR' },
  ],
  ['Edifício Mirante: doze andares, quatro por andar, apartamentos de dois e três dormitórios.', { nome: 'Edifício Mirante', andares: 12, unidadesPorAndar: 4, quartos: [2, 3] }],
  ['Prédio de 8 pavimentos com 6 unidades por pavimento. Studios e 1 quarto. Coworking e lavanderia.', { andares: 8, unidadesPorAndar: 6, quartos: [0, 1], lazerCat: ['coworking', 'outro'] }],
  ['Torre única com 20 andares, 2 subsolos, 3 suítes de 140 m², 3 vagas.', { andares: 20, subsolos: 2, torres: 1, quartos: [3], areas: [140], vagas: 3 }],
  ['Lançamento na Av. Paulista, 1000 - Bela Vista, São Paulo - SP. 25 andares, 8 por andar, studios de 28 m2.', { endereco: 'Av. Paulista, 1000', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP', andares: 25, unidadesPorAndar: 8, quartos: [0], areas: [28] }],
  ['Condomínio Jardim das Flores, 2 torres de 15 andares, 4 aptos por andar, 2 quartos (1 suíte) com 65 m².', { nome: 'Condomínio Jardim das Flores', torres: 2, andares: 15, unidadesPorAndar: 4, quartos: [2], areas: [65], lazerCat: [] }],
  ['Apartamentos de 2 e 3 quartos, de 62 a 85 m², térreo + 10, quatro por andar. Salão de festas, churrasqueira e playground.', { andares: 10, unidadesPorAndar: 4, quartos: [2, 3], areas: [62, 85], lazerCat: ['salao_festas', 'churrasqueira', 'playground'] }],
  ['48 apartamentos em 12 andares (4 por andar). 2 dormitórios. CEP 80240-000.', { totalUnidades: 48, andares: 12, unidadesPorAndar: 4, quartos: [2], cep: '80240-000' }],
  ['Residencial Bosque Verde - 10 andares, 2 por andar, 4 suítes, 220 m2, 4 vagas, piscina aquecida, sauna, quadra de tênis e espaço gourmet. Rua Padre Anchieta, 2050, Curitiba - PR', { nome: 'Residencial Bosque Verde', andares: 10, unidadesPorAndar: 2, quartos: [4], areas: [220], vagas: 4, lazerCat: ['piscina', 'outro', 'quadra', 'espaco_gourmet'], endereco: 'Rua Padre Anchieta, 2050', cidade: 'Curitiba', uf: 'PR' }],
  ['Empreendimento com 1, 2 e 3 quartos, 18 pavimentos, 6 unidades por andar. A partir de R$ 389 mil.', { quartos: [1, 2, 3], andares: 18, unidadesPorAndar: 6, precoAPartirDe: 389_000 }],
  ['Spazio Lumière: 14 andares, quatro unidades por andar, 3 quartos sendo 1 suíte, 92 m², 2 vagas. Piscina, academia, brinquedoteca e pet place.', { nome: 'Spazio Lumière', andares: 14, unidadesPorAndar: 4, quartos: [3], areas: [92], vagas: 2, lazerCat: ['piscina', 'academia', 'brinquedoteca', 'pet'] }],
  ['Prédio na Rua XV de Novembro, 300, Centro, Joinville/SC. 9 andares com 3 apartamentos por andar de 2 quartos.', { endereco: 'Rua XV de Novembro, 300', bairro: 'Centro', cidade: 'Joinville', uf: 'SC', andares: 9, unidadesPorAndar: 3, quartos: [2] }],
  ['Vinte andares, seis por andar, studios e um quarto de 30 e 42 m². Rooftop com piscina.', { andares: 20, unidadesPorAndar: 6, quartos: [0, 1], areas: [30, 42], lazerCat: ['outro', 'piscina'] }],
  ['Edifício Solar do Mar, Avenida Atlântica 1500, Rio de Janeiro (RJ), 16 andares, 2 por andar, 4 quartos com 250 m².', { nome: 'Edifício Solar do Mar', endereco: 'Avenida Atlântica 1500', cidade: 'Rio de Janeiro', uf: 'RJ', andares: 16, unidadesPorAndar: 2, quartos: [4], areas: [250] }],
  ['Casas não. Só um prédio: 5 andares, 4 por andar, 2 quartos, sem lazer.', { andares: 5, unidadesPorAndar: 4, quartos: [2], lazerCat: [] }],
  ['Residencial Ipê, 3 torres de 8 andares, 4 apartamentos por andar, 96 unidades no total, 2 e 3 dorms, churrasqueira, quadra poliesportiva e jardim.', { nome: 'Residencial Ipê', torres: 3, andares: 8, unidadesPorAndar: 4, totalUnidades: 96, quartos: [2, 3], lazerCat: ['churrasqueira', 'quadra', 'jardim'] }],
  ['Living Park: 22 pavimentos, 10 unidades por pavimento, 1 e 2 quartos, 35 a 58 m2, coworking, academia, bicicletário e lavanderia.', { nome: 'Living Park', andares: 22, unidadesPorAndar: 10, quartos: [1, 2], areas: [35, 58], lazerCat: ['coworking', 'academia', 'outro'] }],
  ['Imóvel em Florianópolis, Santa Catarina. 6 andares, 4 por andar, 3 quartos.', { cidade: 'Florianópolis', uf: 'SC', andares: 6, unidadesPorAndar: 4, quartos: [3] }],
  ['Rua Augusta 1200, São Paulo/SP, 01304-001. Doze pavimentos, 2 subsolos, 5 por andar, 1 quarto e 2 quartos.', { endereco: 'Rua Augusta 1200', cidade: 'São Paulo', uf: 'SP', cep: '01304-001', andares: 12, subsolos: 2, unidadesPorAndar: 5, quartos: [1, 2] }],
  ['Edifício Horizonte, 30 andares, 4 por andar, 3 e 4 suítes de 180 e 240 m², 3 vagas, a partir de R$ 2,4 milhões.', { nome: 'Edifício Horizonte', andares: 30, unidadesPorAndar: 4, quartos: [3, 4], areas: [180, 240], vagas: 3, precoAPartirDe: 2_400_000 }],
  ['O prédio tem sete andares e três apartamentos por andar, todos de dois quartos com suíte, 70 m², uma vaga.', { andares: 7, unidadesPorAndar: 3, quartos: [2], areas: [70], vagas: 1 }],
  ['Residencial Primavera em Londrina - PR, 11 andares, 4 por andar, 2 quartos, piscina, salão de jogos, salão de festas.', { nome: 'Residencial Primavera', cidade: 'Londrina', uf: 'PR', andares: 11, unidadesPorAndar: 4, quartos: [2], lazerCat: ['piscina', 'outro', 'salao_festas'] }],
  ['Torre com 40 pavimentos, 6 por pavimento, 2 a 4 quartos, de 70 a 150 m².', { andares: 40, unidadesPorAndar: 6, quartos: [2, 3, 4], areas: [70, 110, 150] }],
  ['Kitnets de 25 m² em prédio de 4 andares com 8 por andar, Rua Marechal Deodoro, 45, Centro, Curitiba/PR.', { quartos: [0], areas: [25], andares: 4, unidadesPorAndar: 8, endereco: 'Rua Marechal Deodoro, 45', bairro: 'Centro', cidade: 'Curitiba', uf: 'PR' }],
  ['Residencial Vista Alegre. Endereço: Alameda Santos, 455, São Paulo - SP. 15 andares, 4 apartamentos por andar, 2 e 3 quartos, 1 a 2 vagas.', { nome: 'Residencial Vista Alegre', endereco: 'Alameda Santos, 455', cidade: 'São Paulo', uf: 'SP', andares: 15, unidadesPorAndar: 4, quartos: [2, 3] }],
  ['Quatro andares, duas unidades por andar, 3 dormitórios, quintal e churrasqueira.', { andares: 4, unidadesPorAndar: 2, quartos: [3], lazerCat: ['churrasqueira'] }],
  ['Edifício Atlântico, 18 andares, 4 por andar, 120 m², 3 quartos, piscina, sauna, academia e espaço gourmet, em Balneário Camboriú, SC.', { nome: 'Edifício Atlântico', andares: 18, unidadesPorAndar: 4, areas: [120], quartos: [3], lazerCat: ['piscina', 'outro', 'academia', 'espaco_gourmet'], cidade: 'Balneário Camboriú', uf: 'SC' }],
  ['Projeto com 60 unidades, 15 andares, 4 por andar, 2 quartos de 58 m², por R$ 450.000.', { totalUnidades: 60, andares: 15, unidadesPorAndar: 4, quartos: [2], areas: [58], precoAPartirDe: 450_000 }],
  ['Condomínio Reserva, Rodovia SC-401, 3000, Florianópolis/SC, 6 andares, 6 por andar, 1, 2 e 3 quartos, beach tennis e piscina.', { nome: 'Condomínio Reserva', endereco: 'Rodovia SC-401, 3000', cidade: 'Florianópolis', uf: 'SC', andares: 6, unidadesPorAndar: 6, quartos: [1, 2, 3], lazerCat: ['quadra', 'piscina'] }],
  ['10 andares e 4 por andar. 2 quartos. Fica perto do metrô, a 300 metros.', { andares: 10, unidadesPorAndar: 4, quartos: [2], areas: [null] }],
];

describe('interpretarDescricao (30 descrições reais)', () => {
  it.each(CASOS)('%s', (texto, esperado) => {
    const d = interpretarDescricao(texto);
    const { quartos, areas, lazerCat, ...campos } = esperado;
    for (const [k, v] of Object.entries(campos)) expect(d[k as keyof typeof d], k).toEqual(v);
    if (quartos) expect(d.tipologias.map((t) => t.quartos)).toEqual(quartos);
    if (areas) expect(d.tipologias.map((t) => t.areaM2)).toEqual(areas);
    if (lazerCat) expect([...new Set(d.lazer.map((l) => l.categoria))]).toEqual([...new Set(lazerCat)]);
  });

  it('suítes: "1 suíte" e "todos suítes" viram o número certo', () => {
    expect(interpretarDescricao('3 quartos sendo 1 suíte').tipologias[0]).toMatchObject({ quartos: 3, suites: 1, nome: '3 quartos (1 suíte)' });
    expect(interpretarDescricao('4 suítes').tipologias[0]).toMatchObject({ quartos: 4, suites: 4, nome: '4 quartos (todos suítes)' });
    expect(interpretarDescricao('2 quartos').tipologias[0]).toMatchObject({ suites: 0, nome: '2 quartos' });
  });

  it('o que falta vira aviso, e a conta que não fecha também', () => {
    expect(interpretarDescricao('Um prédio bonito perto do parque.').avisos).toEqual(['Não achei quantos andares o prédio tem.', 'Não achei as tipologias (quantos quartos).']);
    expect(interpretarDescricao('10 andares, 4 por andar, 50 unidades, 2 quartos').avisos).toEqual(['10 andares × 4 por andar não dá 50 unidades: confira.']);
  });

  it('"Jardim" com maiúscula é nome; "jardim" é lazer', () => {
    expect(interpretarDescricao('Rua X, 10, Jardim Botânico, Curitiba/PR').lazer).toEqual([]);
    expect(interpretarDescricao('com jardim e piscina').lazer.map((l) => l.categoria)).toEqual(['jardim', 'piscina']);
  });

  it('"São Paulo" e "Rio de Janeiro" sozinhos são a capital (cidade e estado ao mesmo tempo)', () => {
    const sp = interpretarDescricao('Residencial Vista, 8 andares, na Avenida Paulista 1000, São Paulo.');
    expect([sp.endereco, sp.cidade, sp.uf]).toEqual(['Avenida Paulista 1000', 'São Paulo', 'SP']);
    const rj = interpretarDescricao('Prédio em Rio de Janeiro, perto da praia');
    expect([rj.cidade, rj.uf]).toEqual(['Rio de Janeiro', 'RJ']);
    // outro estado sozinho continua sendo só o estado
    const pr = interpretarDescricao('Edifício na Rua X 10, no Paraná');
    expect([pr.cidade, pr.uf]).toEqual([null, 'PR']);
  });

  it('nunca lança, nem com texto vazio ou enorme', () => {
    expect(interpretarDescricao('').andares).toBeNull();
    expect(() => interpretarDescricao('9'.repeat(100_000))).not.toThrow();
  });
});
