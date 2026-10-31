import { z } from 'zod';
import { Registro, Login, Refresh, NovoProjeto, MfaConfirmar } from './esquemas';

const esquema = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });
const corpo = (s: z.ZodType) => ({ required: true, content: { 'application/json': { schema: esquema(s) } } });
const r = (codigos: Record<number, string>) =>
  Object.fromEntries(Object.entries(codigos).map(([k, v]) => [k, { description: v }]));
const auth = [{ bearer: [] }];

export function documentoOpenApi() {
  return {
    openapi: '3.1.0',
    info: { title: 'Imersa 3D API', version: '0.1.0' },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths: {
      '/health': { get: { summary: 'Saúde da API e do banco', responses: r({ 200: 'ok' }) } },
      '/auth/registro': { post: { summary: 'Cria empresa + administrador', requestBody: corpo(Registro), responses: r({ 201: 'criado', 400: 'dados inválidos', 409: 'já existe' }) } },
      '/auth/login': { post: { summary: 'Entra numa empresa', requestBody: corpo(Login), responses: r({ 200: 'tokens', 401: 'credenciais inválidas / MFA' }) } },
      '/auth/refresh': { post: { summary: 'Gira o refresh token', requestBody: corpo(Refresh), responses: r({ 200: 'tokens', 401: 'inválido ou reutilizado' }) } },
      '/auth/mfa/ativar': { post: { summary: 'Gera segredo TOTP', security: auth, responses: r({ 200: 'segredo + otpauth' }) } },
      '/auth/mfa/confirmar': { post: { summary: 'Confirma TOTP', security: auth, requestBody: corpo(MfaConfirmar), responses: r({ 204: 'ativado', 400: 'código inválido' }) } },
      '/me': { get: { summary: 'Sessão e empresas do usuário', security: auth, responses: r({ 200: 'ok' }) } },
      '/projetos': {
        get: { summary: 'Lista projetos da empresa', security: auth, responses: r({ 200: 'lista' }) },
        post: { summary: 'Cria projeto', security: auth, requestBody: corpo(NovoProjeto), responses: r({ 201: 'criado', 403: 'sem permissão' }) },
      },
      '/auditoria': { get: { summary: 'Últimas 100 ações da empresa', security: auth, responses: r({ 200: 'lista', 403: 'sem permissão' }) } },
    },
  };
}
