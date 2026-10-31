import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assinar } from './assinatura';

export interface DestinoEnvio {
  url: string;
  metodo: 'PUT';
  cabecalhos: Record<string, string>;
}

interface Alvo {
  chave: string;
  assetId: string;
  tenantId: string;
  expiraS: number;
}

export interface Armazenamento {
  readonly tipo: 'local' | 's3';
  urlEnvio(p: Alvo & { tipoConteudo: string }): Promise<DestinoEnvio>;
  urlDownload(p: Alvo & { nomeArquivo: string }): Promise<string>;
  lerInicio(chave: string, bytes: number): Promise<Buffer>;
  tamanho(chave: string): Promise<number | null>;
  abrirLeitura(chave: string): Promise<Readable>;
  apagar(chave: string): Promise<void>;
}

export class ErroLimite extends Error {
  constructor() {
    super('arquivo maior que o tamanho declarado');
  }
}

const agoraS = () => Math.floor(Date.now() / 1000);

/** Disco local: a própria API recebe o PUT e serve o GET, com links assinados (desenvolvimento e testes). */
export class ArmazenamentoLocal implements Armazenamento {
  readonly tipo = 'local' as const;
  private readonly raiz: string;

  constructor(
    pasta: string,
    private readonly urlPublicaApi: string,
    private readonly segredo: string,
  ) {
    this.raiz = resolve(pasta);
  }

  private caminho(chave: string): string {
    const p = resolve(this.raiz, chave);
    if (!p.startsWith(this.raiz + sep)) throw new Error('chave fora da pasta de armazenamento');
    return p;
  }

  private link(op: 'put' | 'get', assetId: string, tenantId: string, expiraS: number): string {
    const exp = agoraS() + expiraS;
    const q = new URLSearchParams({ t: tenantId, exp: String(exp), sig: assinar(this.segredo, op, assetId, tenantId, exp) });
    return `${this.urlPublicaApi}/arquivos/${assetId}/conteudo?${q}`;
  }

  async urlEnvio(p: Alvo & { tipoConteudo: string }): Promise<DestinoEnvio> {
    return { url: this.link('put', p.assetId, p.tenantId, p.expiraS), metodo: 'PUT', cabecalhos: { 'content-type': 'application/octet-stream' } };
  }

  async urlDownload(p: Alvo & { nomeArquivo: string }): Promise<string> {
    return this.link('get', p.assetId, p.tenantId, p.expiraS);
  }

  /** Grava num arquivo temporário e só renomeia no fim: nunca sobra arquivo pela metade. */
  async gravar(chave: string, origem: Readable, limite: number): Promise<{ tamanho: number; sha256: string }> {
    const final = this.caminho(chave);
    const temporario = `${final}.parcial`;
    await mkdir(dirname(final), { recursive: true });
    const hash = createHash('sha256');
    let tamanho = 0;
    const contador = new Transform({
      transform(pedaco: Buffer, _codificacao, pronto) {
        tamanho += pedaco.length;
        if (tamanho > limite) return pronto(new ErroLimite());
        hash.update(pedaco);
        pronto(null, pedaco);
      },
    });
    try {
      await pipeline(origem, contador, createWriteStream(temporario));
      await rename(temporario, final);
    } catch (e) {
      await rm(temporario, { force: true });
      throw e;
    }
    return { tamanho, sha256: hash.digest('hex') };
  }

  async lerInicio(chave: string, bytes: number): Promise<Buffer> {
    const arquivo = await open(this.caminho(chave), 'r');
    try {
      const b = Buffer.alloc(bytes);
      const { bytesRead } = await arquivo.read(b, 0, bytes, 0);
      return b.subarray(0, bytesRead);
    } finally {
      await arquivo.close();
    }
  }

  async tamanho(chave: string): Promise<number | null> {
    try {
      return (await stat(this.caminho(chave))).size;
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return null;
      throw e;
    }
  }

  async abrirLeitura(chave: string): Promise<Readable> {
    return createReadStream(this.caminho(chave));
  }

  async apagar(chave: string): Promise<void> {
    await rm(this.caminho(chave), { force: true });
  }
}

export interface ConfigS3 {
  bucket: string;
  regiao: string;
  /** Para R2/MinIO/compatíveis. Sem endpoint = AWS. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** S3 (ou compatível): o navegador envia direto ao bucket com URL pré-assinada. O bucket precisa de CORS liberando PUT do site. */
export class ArmazenamentoS3 implements Armazenamento {
  readonly tipo = 's3' as const;
  private readonly s3: S3Client;

  constructor(private readonly cfg: ConfigS3) {
    this.s3 = new S3Client({
      region: cfg.regiao,
      endpoint: cfg.endpoint,
      forcePathStyle: Boolean(cfg.endpoint),
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  async urlEnvio(p: Alvo & { tipoConteudo: string }): Promise<DestinoEnvio> {
    const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.cfg.bucket, Key: p.chave, ContentType: p.tipoConteudo }), { expiresIn: p.expiraS });
    return { url, metodo: 'PUT', cabecalhos: { 'content-type': p.tipoConteudo } };
  }

  async urlDownload(p: Alvo & { nomeArquivo: string }): Promise<string> {
    const disposicao = `attachment; filename="${p.nomeArquivo.replace(/["\\\r\n]/g, '_')}"`;
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.cfg.bucket, Key: p.chave, ResponseContentDisposition: disposicao }), { expiresIn: p.expiraS });
  }

  async lerInicio(chave: string, bytes: number): Promise<Buffer> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: chave, Range: `bytes=0-${bytes - 1}` }));
    return Buffer.from((await r.Body?.transformToByteArray()) ?? []);
  }

  async tamanho(chave: string): Promise<number | null> {
    try {
      return (await this.s3.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: chave }))).ContentLength ?? null;
    } catch (e) {
      if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async abrirLeitura(chave: string): Promise<Readable> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: chave }));
    return r.Body as Readable;
  }

  async apagar(chave: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: chave }));
  }
}
