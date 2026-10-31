import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ArmazenamentoLocal, ArmazenamentoS3, ErroLimite } from './armazenamento';
import { conferirAssinatura } from './assinatura';

const S = 'segredo-de-teste-com-mais-de-32-caracteres!!';
let pasta = '';
let local: ArmazenamentoLocal;

beforeAll(async () => {
  pasta = await mkdtemp(join(tmpdir(), 'imersa-armazenamento-'));
  local = new ArmazenamentoLocal(pasta, 'http://api.local', S);
});
afterAll(() => rm(pasta, { recursive: true, force: true }));

describe('armazenamento local', () => {
  it('grava, mede, calcula SHA-256, lê o início e apaga', async () => {
    const r = await local.gravar('emp/proj/arq/casa.glb', Readable.from([Buffer.from('glTF'), Buffer.from('-resto')]), 100);
    expect(r).toEqual({ tamanho: 10, sha256: createHash('sha256').update('glTF-resto').digest('hex') });
    expect(await local.tamanho('emp/proj/arq/casa.glb')).toBe(10);
    expect((await local.lerInicio('emp/proj/arq/casa.glb', 4)).toString()).toBe('glTF');
    await local.apagar('emp/proj/arq/casa.glb');
    expect(await local.tamanho('emp/proj/arq/casa.glb')).toBeNull();
  });

  it('passou do limite: erro e nenhum arquivo (nem parcial) fica no disco', async () => {
    await expect(local.gravar('emp/x/grande.bin', Readable.from([Buffer.alloc(60), Buffer.alloc(60)]), 100)).rejects.toBeInstanceOf(ErroLimite);
    expect(await readdir(join(pasta, 'emp', 'x'))).toEqual([]);
  });

  it('o servidor grava um arquivo pronto (resultado do worker) e lê de volta igual', async () => {
    const dados = Buffer.from('splat gerado pelo worker');
    await local.salvar('t/p/capturas/c1/resultado.sog', dados, 'application/octet-stream');
    expect(await local.tamanho('t/p/capturas/c1/resultado.sog')).toBe(dados.length);
    const lido: Buffer[] = [];
    for await (const parte of await local.abrirLeitura('t/p/capturas/c1/resultado.sog')) lido.push(parte as Buffer);
    expect(Buffer.concat(lido).equals(dados)).toBe(true);
    await expect(local.salvar('../fora.sog', dados, 'application/octet-stream')).rejects.toThrow();
  });

  it('recusa chave que sai da pasta', async () => {
    await expect(local.gravar('../fora.txt', Readable.from([Buffer.from('x')]), 10)).rejects.toThrow(/fora da pasta/);
  });

  it('links de envio e download apontam para a API e vêm assinados', async () => {
    const envio = await local.urlEnvio({ chave: 'k', assetId: 'a1', tenantId: 't1', tipoConteudo: 'model/gltf-binary', expiraS: 600 });
    expect(envio.metodo).toBe('PUT');
    const u = new URL(envio.url);
    expect(`${u.origin}${u.pathname}`).toBe('http://api.local/arquivos/a1/conteudo');
    expect(conferirAssinatura(S, 'put', 'a1', 't1', Number(u.searchParams.get('exp')), u.searchParams.get('sig') ?? '')).toBe(true);
    const d = new URL(await local.urlDownload({ chave: 'k', assetId: 'a1', tenantId: 't1', nomeArquivo: 'casa.glb', expiraS: 600 }));
    expect(conferirAssinatura(S, 'get', 'a1', 't1', Number(d.searchParams.get('exp')), d.searchParams.get('sig') ?? '')).toBe(true);
  });
});

describe('armazenamento S3 (URL pré-assinada gerada offline)', () => {
  const s3 = new ArmazenamentoS3({ bucket: 'imersa-teste', regiao: 'us-east-1', endpoint: 'http://localhost:9000', accessKeyId: 'AKIATESTE', secretAccessKey: 'segredo' });

  it('envio direto do navegador para o bucket', async () => {
    const envio = await s3.urlEnvio({ chave: 'emp/proj/arq/casa.glb', assetId: 'a1', tenantId: 't1', tipoConteudo: 'model/gltf-binary', expiraS: 900 });
    const u = new URL(envio.url);
    expect(u.host).toBe('localhost:9000');
    expect(u.pathname).toBe('/imersa-teste/emp/proj/arq/casa.glb');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(envio.cabecalhos).toEqual({ 'content-type': 'model/gltf-binary' });
  });

  it('download assinado com nome do arquivo', async () => {
    const u = new URL(await s3.urlDownload({ chave: 'emp/proj/arq/casa.glb', assetId: 'a1', tenantId: 't1', nomeArquivo: 'casa.glb', expiraS: 300 }));
    expect(u.searchParams.get('response-content-disposition')).toBe('attachment; filename="casa.glb"');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300');
  });
});
