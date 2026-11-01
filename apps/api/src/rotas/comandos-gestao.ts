import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTenant } from '@imersa/db';
import { ErroHttp } from '../erros';
import type { Acao } from '../auth/rbac';
import type { Sessao } from '../auth/tokens';
import { registrarAuditoria } from '../auditoria';
import { IdParam } from '../esquemas';
import { registrarMudancaStatus } from '../importar';
import { validarTransicao, type StatusUnidade } from '../dominio/status';
import { lerPedidosGestao } from '../criacao/gestao-por-texto';

interface Dependencias {
  pool: pg.Pool;
  exigir: (req: FastifyRequest, acao?: Acao) => Promise<Sessao>;
}

const Pedido = z.object({ texto: z.string().trim().min(3).max(500), aplicar: z.boolean().default(false) });
const ctx = (s: Sessao) => ({ tenantId: s.tenantId, userId: s.userId });
const ROTULO: Record<StatusUnidade, string> = { disponivel: 'disponível', reservado: 'reservada', vendido: 'vendida', bloqueado: 'bloqueada' };
// espaço comum no lugar do não separável do Intl (o texto vai para a tela e para a auditoria)
const reais = (v: number | null) => (v === null ? 'sem preço' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' '));

/** O que o estúdio ou a Vitrine fazem depois da confirmação (a tela chama as ações que já existem). */
type AcaoDepois = { tipo: 'video'; formato: '9:16' | '1:1' | '16:9'; voz: 'pf_dora' | 'pm_alex' | null } | { tipo: 'foto'; unidadeId: string | null; hora: number };

/**
 * Editar o empreendimento e pedir material por texto (Plano 11e, itens 22 e 23). Primeiro mostra o que vai mudar;
 * só grava com `aplicar: true` (a pessoa confirmou), numa transação, com auditoria do texto e de cada mudança.
 */
export function rotasComandosGestao(app: FastifyInstance, { pool, exigir }: Dependencias): void {
  app.post('/predios/:id/comandos', { bodyLimit: 16 * 1024 }, async (req) => {
    const s = await exigir(req, 'empreendimento:editar');
    const { id } = IdParam.parse(req.params);
    const { texto, aplicar } = Pedido.parse(req.body);
    const pedidos = lerPedidosGestao(texto);
    return withTenant(pool, ctx(s), async (c) => {
      if (!(await c.query('SELECT 1 FROM buildings WHERE id = $1', [id])).rowCount) throw new ErroHttp(404, 'nao_encontrado');
      const unidades = (
        await c.query<{ id: string; codigo: string; status: StatusUnidade; preco: number | null; andar: number; floor_id: string; unit_type_id: string | null }>(
          `SELECT u.id, u.codigo, u.status, u.preco::float8 AS preco, f.numero AS andar, u.floor_id, u.unit_type_id
             FROM units u JOIN floors f ON f.id = u.floor_id WHERE u.building_id = $1 ${aplicar ? 'FOR UPDATE OF u' : ''}`,
          [id],
        )
      ).rows;
      const porCodigo = new Map(unidades.map((u) => [u.codigo.toUpperCase(), u]));
      const mudancas: string[] = [];
      const avisos: string[] = [];
      const acoes: AcaoDepois[] = [];
      const aplicacoes: Array<() => Promise<void>> = [];
      if (!pedidos.length) avisos.push('Não entendi o pedido. Exemplos: "a 302 foi vendida", "a 1201 custa 850 mil", "o 5º andar agora tem 6 unidades", "vídeo para o Instagram com voz masculina".');

      for (const p of pedidos) {
        if (p.tipo === 'status' || p.tipo === 'preco') {
          const u = porCodigo.get(p.codigo);
          if (!u) {
            avisos.push(`Não há unidade ${p.codigo} neste prédio.`);
            continue;
          }
          if (p.tipo === 'preco') {
            if (u.preco === p.preco) {
              avisos.push(`A ${u.codigo} já custa ${reais(p.preco)}.`);
              continue;
            }
            mudancas.push(`Preço da ${u.codigo}: ${reais(u.preco)} → ${reais(p.preco)}`);
            aplicacoes.push(async () => {
              await c.query('UPDATE units SET preco = $2 WHERE id = $1', [u.id, p.preco]);
              await registrarAuditoria(c, { userId: s.userId, acao: 'unidade.editar', entidade: 'unit', entidadeId: u.id, antes: { preco: u.preco }, depois: { preco: p.preco, comando: texto } });
            });
            continue;
          }
          if (u.status === p.status) {
            avisos.push(`A ${u.codigo} já está ${ROTULO[p.status]}.`);
            continue;
          }
          const motivo = `Pedido por texto: "${texto}"`;
          const v = validarTransicao(s.papel, u.status, p.status, motivo);
          if (!v.ok) {
            avisos.push(`A ${u.codigo} não pode passar de ${ROTULO[u.status]} para ${ROTULO[p.status]}.`);
            continue;
          }
          mudancas.push(`${u.codigo}: ${ROTULO[u.status]} → ${ROTULO[p.status]}`);
          aplicacoes.push(async () => {
            await c.query('UPDATE units SET status = $2 WHERE id = $1', [u.id, p.status]);
            await registrarMudancaStatus(c, u.id, u.status, p.status, s.userId, motivo);
            await registrarAuditoria(c, { userId: s.userId, acao: 'unidade.status', entidade: 'unit', entidadeId: u.id, antes: { status: u.status }, depois: { status: p.status, motivo } });
          });
        } else if (p.tipo === 'unidades_no_andar') {
          const doAndar = unidades.filter((u) => u.andar === p.andar);
          if (!doAndar.length) {
            avisos.push(`O ${p.andar}º andar não tem unidades neste prédio (crie o andar pela tela de unidades).`);
            continue;
          }
          if (p.quantidade < doAndar.length) {
            avisos.push(`O ${p.andar}º andar tem ${doAndar.length} unidades: para tirar unidades, use a tela de unidades (nada some por texto).`);
            continue;
          }
          if (p.quantidade === doAndar.length) {
            avisos.push(`O ${p.andar}º andar já tem ${p.quantidade} unidades.`);
            continue;
          }
          // códigos que faltam no padrão do andar (101, 102...), com a tipologia mais comum do andar
          const usados = new Set(unidades.map((u) => u.codigo.toUpperCase()));
          const novos: string[] = [];
          for (let i = 1; novos.length < p.quantidade - doAndar.length && i < 100; i++) {
            const cod = `${p.andar}${String(i).padStart(2, '0')}`;
            if (!usados.has(cod)) novos.push(cod);
          }
          const contagem = new Map<string | null, number>();
          for (const u of doAndar) contagem.set(u.unit_type_id, (contagem.get(u.unit_type_id) ?? 0) + 1);
          const tipologia = [...contagem].sort((a, b) => b[1] - a[1])[0]![0];
          mudancas.push(`${p.andar}º andar: ${doAndar.length} → ${p.quantidade} unidades (novas: ${novos.join(', ')}, disponíveis, sem preço)`);
          aplicacoes.push(async () => {
            for (const cod of novos) {
              const r = await c.query<{ id: string }>("INSERT INTO units (building_id, floor_id, unit_type_id, codigo, status) VALUES ($1, $2, $3, $4, 'disponivel') RETURNING id", [id, doAndar[0]!.floor_id, tipologia, cod]);
              await registrarAuditoria(c, { userId: s.userId, acao: 'unidade.criar', entidade: 'unit', entidadeId: r.rows[0]!.id, depois: { codigo: cod, andar: p.andar, comando: texto } });
            }
          });
        } else if (p.tipo === 'video') {
          mudancas.push(`Pedir vídeo ${p.formato === '9:16' ? 'vertical (Instagram, Reels, Stories)' : p.formato === '1:1' ? 'quadrado (feed)' : 'horizontal (YouTube)'} ${p.voz ? `com voz ${p.voz === 'pm_alex' ? 'masculina' : 'feminina'} e legenda` : 'sem narração'}`);
          if (p.duracaoPedida) avisos.push(`O vídeo tem a duração do passeio de câmera do estúdio: os ${p.duracaoPedida} s pedidos não mudam o tamanho.`);
          acoes.push({ tipo: 'video', formato: p.formato, voz: p.voz });
        } else if (p.tipo === 'foto') {
          const u = p.codigo ? porCodigo.get(p.codigo) : null;
          if (p.codigo && !u) {
            avisos.push(`Não há unidade ${p.codigo} neste prédio.`);
            continue;
          }
          mudancas.push(`Abrir a foto fotorrealista ${u ? `da ${u.codigo} ` : ''}às ${p.hora}h na Vitrine`);
          acoes.push({ tipo: 'foto', unidadeId: u?.id ?? null, hora: p.hora });
        }
      }

      if (aplicar) {
        // nada é gravado sem a pessoa confirmar: com aplicar, tudo numa transação (ou nada)
        for (const a of aplicacoes) await a();
        if (aplicacoes.length || acoes.length) await registrarAuditoria(c, { userId: s.userId, acao: 'comando.aplicar', entidade: 'building', entidadeId: id, depois: { texto, mudancas, avisos } });
      }
      return { aplicado: aplicar, mudancas, avisos, acoes: aplicar ? acoes : [] };
    });
  });
}
