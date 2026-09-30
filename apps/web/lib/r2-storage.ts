import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

type R2Config = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let client: S3Client | null | undefined;

function getR2Config(): R2Config | null {
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const endpoint = process.env.R2_ENDPOINT?.trim() || (
    accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined
  );
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return { bucket, endpoint, accessKeyId, secretAccessKey };
}

function getR2Client(): S3Client | null {
  if (client !== undefined) return client;

  const config = getR2Config();
  if (!config) {
    client = null;
    return client;
  }

  client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return client;
}

export function isR2Configured(): boolean {
  return Boolean(getR2Config());
}

export function storageUrlForKey(key: string): string {
  return `/api/files/${encodeURI(key.replace(/^\/+/, ''))}`;
}

export function storageKeyFromUrl(url: string): string | null {
  const prefix = '/api/files/';
  if (!url.startsWith(prefix)) return null;
  let key: string;
  try {
    key = decodeURI(url.slice(prefix.length));
  } catch {
    return null;
  }
  if (!isAllowedStorageKey(key)) return null;
  return key;
}

export function isAllowedStorageKey(key: string): boolean {
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('//')) return false;
  return key.startsWith('uploads/');
}

export async function putStorageObject(params: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  contentLength?: number;
}): Promise<void> {
  const r2 = getR2Client();
  const config = getR2Config();
  if (!r2 || !config) throw new Error('R2 nao configurado.');
  if (!isAllowedStorageKey(params.key)) throw new Error('Chave de arquivo invalida.');

  await r2.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
    }),
  );
}

export async function getStorageObject(key: string) {
  const r2 = getR2Client();
  const config = getR2Config();
  if (!r2 || !config) throw new Error('R2 nao configurado.');
  if (!isAllowedStorageKey(key)) throw new Error('Chave de arquivo invalida.');

  return r2.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
}

export async function deleteStorageObject(key: string): Promise<void> {
  const r2 = getR2Client();
  const config = getR2Config();
  if (!r2 || !config) throw new Error('R2 nao configurado.');
  if (!isAllowedStorageKey(key)) throw new Error('Chave de arquivo invalida.');

  await r2.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}



export async function headStorageObject(key: string) {
  const r2 = getR2Client();
  const config = getR2Config();
  if (!r2 || !config) throw new Error('R2 nao configurado.');
  if (!isAllowedStorageKey(key)) throw new Error('Chave de arquivo invalida.');
  return r2.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
}

export async function readStorageObjectPrefix(key: string, length = 32) {
  const r2 = getR2Client();
  const config = getR2Config();
  if (!r2 || !config) throw new Error('R2 nao configurado.');
  if (!isAllowedStorageKey(key)) throw new Error('Chave de arquivo invalida.');
  const response = await r2.send(new GetObjectCommand({ Bucket: config.bucket, Key: key, Range: `bytes=0-${Math.max(0, length - 1)}` }));
  return response.Body ? new Uint8Array(await response.Body.transformToByteArray()) : new Uint8Array();
}

export async function hashStorageObject(key: string): Promise<string> {
  const response = await getStorageObject(key);
  if (!response.Body) throw new Error('Objeto de armazenamento vazio.');
  const hash = createHash('sha256');
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) hash.update(chunk);
  return hash.digest('hex');
}


export async function createPresignedUpload(params: { key: string; contentType: string; reservationId: string; expectedSize: number; expiresInSeconds: number }) {
  const r2 = getR2Client();
  const config = getR2Config();
  if (!r2 || !config) throw new Error('R2 nao configurado.');
  if (!isAllowedStorageKey(params.key) || !params.key.startsWith('uploads/pending/')) throw new Error('Chave de upload invalida.');
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
    ContentType: params.contentType,
    ContentLength: params.expectedSize,
    Metadata: { 'upload-reservation-id': params.reservationId, 'expected-size': String(params.expectedSize) },
  });
  return getSignedUrl(r2 as unknown as Parameters<typeof getSignedUrl>[0], command as unknown as Parameters<typeof getSignedUrl>[1], {
    expiresIn: params.expiresInSeconds,
    signableHeaders: new Set(['content-length', 'content-type']),
    unhoistableHeaders: new Set(['x-amz-meta-upload-reservation-id', 'x-amz-meta-expected-size']),
  });
}

export async function promotePendingUpload(pendingKey: string, finalKey: string, contentType: string) {
  const r2 = getR2Client();
  const config = getR2Config();
  if (!r2 || !config) throw new Error('R2 nao configurado.');
  if (!pendingKey.startsWith('uploads/pending/') || !isAllowedStorageKey(finalKey) || finalKey.startsWith('uploads/pending/')) throw new Error('Chave de upload invalida.');
  const copySource = `/${config.bucket}/${pendingKey.split('/').map(encodeURIComponent).join('/')}`;
  await r2.send(new CopyObjectCommand({
    Bucket: config.bucket,
    Key: finalKey,
    CopySource: copySource,
    MetadataDirective: 'REPLACE',
    ContentType: contentType,
    Metadata: { 'upload-reservation-promoted': 'true' },
  }));
}
