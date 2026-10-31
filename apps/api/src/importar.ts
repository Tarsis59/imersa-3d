import type pg from 'pg';
import type { Sessao } from './auth/tokens';
import { validarTransicao, type StatusUnidade } from './dominio/status';
import type { ErroPlanilha, LinhaPlanilha } from './dominio/planilha';

export interface Resumo {
  prediosNovos: number;
  andaresNovos: number;
  tipologiasNovas: number;
  unidadesNovas: number;
  unidadesAlteradas: number;
  statusAlterados: number;
  semMudanca: number;
}

export const nomeDoAndar = (n: number): string => (n === 0 ? 'Térreo' : n < 0 ? `Subsolo ${-n}` : `${n}º andar`);

const ROTULO: Record<StatusUnidade, string> = { disponivel: 'disponível', reservado: 'reservado', vendido: 'vendido', bloqueado: 'bloqueado' };

/** Grava a planilha já validada. Tudo na transação do chamador: se houver erro, quem chama desfaz. */
export async function aplicarPlanilha(
  c: pg.PoolClient,
  projetoId: string,
  linhas: LinhaPlanilha[],
  s: Sessao,
): Promise<{ resumo: Resumo; erros: ErroPlanilha[] }> {
  const resumo: Resumo = { prediosNovos: 0, andaresNovos: 0, tipologiasNovas: 0, unidadesNovas: 0, unidadesAlteradas: 0, statusAlterados: 0, semMudanca: 0 };
  const erros: ErroPlanilha[] = [];

  const predios = new Map(
    (await c.query<{ id: string; nome: string }>('SELECT id, nome FROM buildings WHERE project_id = $1', [projetoId])).rows.map((r) => [r.nome, r.id]),
  );
  const andares = new Map(
    (
      await c.query<{ id: string; building_id: string; numero: number }>(
        'SELECT f.id, f.building_id, f.numero FROM floors f JOIN buildings b ON b.id = f.building_id WHERE b.project_id = $1',
        [projetoId],
      )
    ).rows.map((r) => [`${r.building_id}|${r.numero}`, r.id]),
  );
  const tipologias = new Map(
    (
      await c.query<{ id: string; nome: string; area_m2: number; quartos: number; suites: number; vagas: number }>(
        'SELECT id, nome, area_m2::float8 AS area_m2, quartos, suites, vagas FROM unit_types WHERE project_id = $1',
        [projetoId],
      )
    ).rows.map((r) => [r.nome, r]),
  );
  const unidades = new Map(
    (
      await c.query<{ id: string; building_id: string; codigo: string; floor_id: string; unit_type_id: string | null; preco: number | null; status: StatusUnidade }>(
        'SELECT u.id, u.building_id, u.codigo, u.floor_id, u.unit_type_id, u.preco::float8 AS preco, u.status FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.project_id = $1',
        [projetoId],
      )
    ).rows.map((r) => [`${r.building_id}|${r.codigo}`, r]),
  );

  for (const l of linhas) {
    let predioId = predios.get(l.predio);
    if (!predioId) {
      predioId = (await c.query<{ id: string }>('INSERT INTO buildings (project_id, nome) VALUES ($1, $2) RETURNING id', [projetoId, l.predio])).rows[0]!.id;
      predios.set(l.predio, predioId);
      resumo.prediosNovos++;
    }

    let andarId = andares.get(`${predioId}|${l.andar}`);
    if (!andarId) {
      andarId = (
        await c.query<{ id: string }>('INSERT INTO floors (building_id, numero, nome) VALUES ($1, $2, $3) RETURNING id', [predioId, l.andar, nomeDoAndar(l.andar)])
      ).rows[0]!.id;
      andares.set(`${predioId}|${l.andar}`, andarId);
      resumo.andaresNovos++;
    }

    let tipologiaId: string | null = null;
    if (l.tipologia) {
      const existente = tipologias.get(l.tipologia);
      if (existente) {
        const difere =
          (l.areaM2 !== null && l.areaM2 !== existente.area_m2) ||
          (l.quartos !== null && l.quartos !== existente.quartos) ||
          (l.suites !== null && l.suites !== existente.suites) ||
          (l.vagas !== null && l.vagas !== existente.vagas);
        if (difere) {
          erros.push({ linha: l.linha, campo: 'tipologia', mensagem: `tipologia "${l.tipologia}" já existe com outros valores; ajuste na tela de tipologias` });
          continue;
        }
        tipologiaId = existente.id;
      } else {
        if (l.areaM2 === null) {
          erros.push({ linha: l.linha, campo: 'area_m2', mensagem: `obrigatório para criar a tipologia "${l.tipologia}"` });
          continue;
        }
        const nova = (
          await c.query<{ id: string }>(
            'INSERT INTO unit_types (project_id, nome, area_m2, quartos, suites, vagas) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [projetoId, l.tipologia, l.areaM2, l.quartos ?? 0, l.suites ?? 0, l.vagas ?? 0],
          )
        ).rows[0]!;
        tipologias.set(l.tipologia, { id: nova.id, nome: l.tipologia, area_m2: l.areaM2, quartos: l.quartos ?? 0, suites: l.suites ?? 0, vagas: l.vagas ?? 0 });
        tipologiaId = nova.id;
        resumo.tipologiasNovas++;
      }
    }

    const atual = unidades.get(`${predioId}|${l.codigo}`);
    if (!atual) {
      const nova = (
        await c.query<{ id: string }>(
          'INSERT INTO units (building_id, floor_id, unit_type_id, codigo, preco, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [predioId, andarId, tipologiaId, l.codigo, l.preco, l.status ?? 'disponivel'],
        )
      ).rows[0]!;
      unidades.set(`${predioId}|${l.codigo}`, { id: nova.id, building_id: predioId, codigo: l.codigo, floor_id: andarId, unit_type_id: tipologiaId, preco: l.preco, status: l.status ?? 'disponivel' });
      resumo.unidadesNovas++;
      continue;
    }

    const mudancas: string[] = [];
    const valores: unknown[] = [];
    const mudar = (coluna: string, valor: unknown) => {
      valores.push(valor);
      mudancas.push(`${coluna} = $${valores.length + 1}`);
    };
    if (atual.floor_id !== andarId) mudar('floor_id', andarId);
    if (l.tipologia && atual.unit_type_id !== tipologiaId) mudar('unit_type_id', tipologiaId);
    if (l.preco !== null && atual.preco !== l.preco) mudar('preco', l.preco);

    let statusMudou = false;
    if (l.status && l.status !== atual.status) {
      const v = validarTransicao(s.papel, atual.status, l.status, 'importação de planilha');
      if (!v.ok) {
        erros.push({ linha: l.linha, campo: 'status', mensagem: `mudança de ${ROTULO[atual.status]} para ${ROTULO[l.status]} não é permitida` });
        continue;
      }
      mudar('status', l.status);
      statusMudou = true;
    }

    if (mudancas.length === 0) {
      resumo.semMudanca++;
      continue;
    }
    await c.query(`UPDATE units SET ${mudancas.join(', ')} WHERE id = $1`, [atual.id, ...valores]);
    if (statusMudou && l.status) {
      await registrarMudancaStatus(c, atual.id, atual.status, l.status, s.userId, 'importação de planilha');
      resumo.statusAlterados++;
      atual.status = l.status;
    }
    if (mudancas.length > (statusMudou ? 1 : 0)) resumo.unidadesAlteradas++;
  }
  return { resumo, erros };
}

/** Histórico + evento no outbox, na mesma transação da mudança. */
export async function registrarMudancaStatus(
  c: pg.PoolClient,
  unidadeId: string,
  de: StatusUnidade,
  para: StatusUnidade,
  userId: string,
  motivo: string | null,
): Promise<void> {
  await c.query('INSERT INTO unit_status_history (unit_id, de, para, user_id, motivo) VALUES ($1, $2, $3, $4, $5)', [unidadeId, de, para, userId, motivo]);
  await c.query("INSERT INTO eventos (tipo, entidade_id, dados) VALUES ('unidade.status_alterado', $1, $2)", [
    unidadeId,
    JSON.stringify({ de, para, userId }),
  ]);
}
