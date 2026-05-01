import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

type R2Config = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let client: S3Client | null | undefined;

function getR2Config(): R2Config | null {
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  const endpoint = process.env.R2_ENDPOINT?.trim();
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
  const key = decodeURI(url.slice(prefix.length));
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
