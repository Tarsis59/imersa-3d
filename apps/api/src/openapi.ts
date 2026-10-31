import { z } from 'zod';
import {
  Registro,
  Login,
  Refresh,
  Sair,
  NovoProjeto,
  MfaConfirmar,
  NovoConvite,
  AceitarConvite,
  AtualizarProjeto,
  NovoPredio,
  NovaTipologia,
  NovaUnidade,
  AtualizarUnidade,
  MudarStatus,
  Importacao,
} from './esquemas';

const esquema = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });
const corpo = (s: z.ZodType) => ({ required: true, content: { 'application/json': { schema: esquema(s) } } });
const r = (codigos: Record<number, string>) =>
  Object.fromEntries(Object.entries(codigos).map(([k, v]) => [k, { description: v }]));
const auth = [{ bearer: [] }];

export function documentoOpenApi() {
  return {
    openapi: '3.1.0',
    info: { title: 'Imersa 3D API', version: '0.2.0' },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths: {
      '/health': { get: { summary: 'Saúde da API e do banco', responses: r({ 200: 'ok', 500: 'erro' }) } },
      '/auth/registro': { post: { summary: 'Cria empresa + administrador', requestBody: corpo(Registro), responses: r({ 201: 'criado', 400: 'dados inválidos', 409: 'já existe' }) } },
      '/auth/login': { post: { summary: 'Entra numa empresa', requestBody: corpo(Login), responses: r({ 200: 'tokens', 401: 'credenciais inválidas / MFA' }) } },
      '/auth/refresh': { post: { summary: 'Gira o refresh token', requestBody: corpo(Refresh), responses: r({ 200: 'tokens', 401: 'inválido ou reutilizado' }) } },
      '/auth/sair': { post: { summary: 'Revoga a sessão', requestBody: corpo(Sair), responses: r({ 204: 'ok' }) } },
      '/auth/mfa/ativar': { post: { summary: 'Gera segredo TOTP', security: auth, responses: r({ 200: 'segredo + otpauth' }) } },
      '/auth/mfa/confirmar': { post: { summary: 'Confirma TOTP e devolve tokens com MFA', security: auth, requestBody: corpo(MfaConfirmar), responses: r({ 200: 'tokens', 400: 'código inválido' }) } },
      '/me': { get: { summary: 'Sessão e empresas do usuário', security: auth, responses: r({ 200: 'ok' }) } },
      '/projetos': {
        get: { summary: 'Lista projetos da empresa', security: auth, responses: r({ 200: 'lista' }) },
        post: { summary: 'Cria projeto (gestão + MFA)', security: auth, requestBody: corpo(NovoProjeto), responses: r({ 201: 'criado', 403: 'sem permissão / mfa_requerido' }) },
      },
      '/membros': { get: { summary: 'Membros e convites pendentes (gestão + MFA)', security: auth, responses: r({ 200: 'lista', 403: 'sem permissão' }) } },
      '/membros/convites': { post: { summary: 'Cria convite (gestão + MFA)', security: auth, requestBody: corpo(NovoConvite), responses: r({ 201: 'link do convite', 403: 'sem permissão' }) } },
      '/convites/{token}': { get: { summary: 'Dados públicos do convite', responses: r({ 200: 'convite', 404: 'inválido ou expirado' }) } },
      '/convites/aceitar': { post: { summary: 'Aceita convite (cria conta ou usa a existente)', requestBody: corpo(AceitarConvite), responses: r({ 201: 'membro', 401: 'senha errada', 404: 'inválido', 409: 'já é membro' }) } },
      '/projetos/{id}': {
        get: { summary: 'Empreendimento: dados, prédios, tipologias e resumo de status', security: auth, responses: r({ 200: 'detalhe', 404: 'não encontrado' }) },
        patch: { summary: 'Edita dados e localização (gestão + MFA)', security: auth, requestBody: corpo(AtualizarProjeto), responses: r({ 200: 'ok', 400: 'dados inválidos', 404: 'não encontrado' }) },
      },
      '/projetos/{id}/predios': { post: { summary: 'Cria prédio com andares (gestão + MFA)', security: auth, requestBody: corpo(NovoPredio), responses: r({ 201: 'criado', 409: 'nome repetido' }) } },
      '/projetos/{id}/tipologias': { post: { summary: 'Cria tipologia (gestão + MFA)', security: auth, requestBody: corpo(NovaTipologia), responses: r({ 201: 'criada', 409: 'nome repetido' }) } },
      '/projetos/{id}/importacao': {
        post: { summary: 'Importa unidades por CSV: prévia (aplicar=false) ou gravação (aplicar=true)', security: auth, requestBody: corpo(Importacao), responses: r({ 200: 'resumo e erros', 400: 'erros: nada foi gravado' }) },
      },
      '/predios/{id}': { get: { summary: 'Espelho de vendas: andares e unidades com transições permitidas', security: auth, responses: r({ 200: 'espelho', 404: 'não encontrado' }) } },
      '/predios/{id}/unidades': { post: { summary: 'Cria unidade (gestão + MFA)', security: auth, requestBody: corpo(NovaUnidade), responses: r({ 201: 'criada', 400: 'andar inexistente', 409: 'código repetido' }) } },
      '/unidades/{id}': { patch: { summary: 'Edita preço, tipologia ou nó 3D (gestão + MFA)', security: auth, requestBody: corpo(AtualizarUnidade), responses: r({ 200: 'ok' }) } },
      '/unidades/{id}/status': {
        post: { summary: 'Muda status seguindo as regras', security: auth, requestBody: corpo(MudarStatus), responses: r({ 200: 'ok', 400: 'motivo obrigatório', 403: 'sem permissão', 409: 'transição inválida' }) },
      },
      '/unidades/{id}/historico': { get: { summary: 'Histórico de status', security: auth, responses: r({ 200: 'lista' }) } },
      '/auditoria': { get: { summary: 'Últimas 100 ações da empresa (gestão + MFA)', security: auth, responses: r({ 200: 'lista', 403: 'sem permissão' }) } },
    },
  };
}
