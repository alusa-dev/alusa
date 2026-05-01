import path from 'path';
import fs from 'fs/promises';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { prisma } from '../prisma';
import type { ProductImage } from '@prisma/client';

const UPLOAD_DIR_BASE = 'public/uploads/produtos';
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_IMAGES_PER_PRODUCT = 8;

let r2Client: S3Client | null | undefined;

function getR2Config() {
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return { bucket, endpoint, accessKeyId, secretAccessKey };
}

function getR2Client(): S3Client | null {
  if (r2Client !== undefined) return r2Client;
  const config = getR2Config();
  if (!config) {
    r2Client = null;
    return r2Client;
  }

  r2Client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return r2Client;
}

function isR2Configured(): boolean {
  return Boolean(getR2Config());
}

function storageUrlForKey(key: string): string {
  return `/api/files/${encodeURI(key.replace(/^\/+/, ''))}`;
}

function storageKeyFromUrl(url: string): string | null {
  const prefix = '/api/files/';
  if (!url.startsWith(prefix)) return null;
  const key = decodeURI(url.slice(prefix.length));
  if (!key.startsWith('uploads/') || key.includes('..') || key.includes('//')) return null;
  return key;
}

export async function listProductImages(productId: string, contaId: string): Promise<ProductImage[]> {
  const product = await prisma.product.findFirst({ where: { id: productId, contaId } });
  if (!product) throw new Error('Produto não encontrado');

  return prisma.productImage.findMany({
    where: { productId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function addProductImage(input: {
  productId: string;
  contaId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  fileSize: number;
}): Promise<ProductImage> {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, contaId: input.contaId },
  });
  if (!product) throw new Error('Produto não encontrado');

  const ext = path.extname(input.fileName).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error('Extensão de arquivo não permitida.');
  }
  if (input.fileSize > MAX_SIZE_BYTES) {
    throw new Error('Arquivo excede o tamanho máximo de 5MB.');
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new Error('Tipo de arquivo não permitido.');
  }

  const count = await prisma.productImage.count({ where: { productId: input.productId } });
  if (count >= MAX_IMAGES_PER_PRODUCT) {
    throw new Error(`Máximo de ${MAX_IMAGES_PER_PRODUCT} imagens por produto.`);
  }

  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const relativeDir = `${UPLOAD_DIR_BASE}/${input.contaId}/${input.productId}`;
  const key = `${relativeDir.replace(/^public\//, '')}/${uniqueName}`;
  let url: string;
  if (isR2Configured()) {
    const config = getR2Config();
    const r2 = getR2Client();
    if (!config || !r2) throw new Error('R2 nao configurado.');
    await r2.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: input.fileBuffer,
        ContentType: input.mimeType,
        ContentLength: input.fileSize,
      }),
    );
    url = storageUrlForKey(key);
  } else {
    const absoluteDir = path.join(process.cwd(), relativeDir);
    await fs.mkdir(absoluteDir, { recursive: true });

    const absolutePath = path.join(absoluteDir, uniqueName);
    await fs.writeFile(absolutePath, input.fileBuffer);

    // URL pública: remove o prefixo 'public/' pois o Next.js serve a pasta public/ em /
    url = `/${key}`;
  }
  const isPrimary = count === 0;

  return prisma.productImage.create({
    data: {
      productId: input.productId,
      url,
      sortOrder: count,
      isPrimary,
    },
  });
}

export async function deleteProductImage(
  imageId: string,
  productId: string,
  contaId: string,
): Promise<void> {
  const product = await prisma.product.findFirst({ where: { id: productId, contaId } });
  if (!product) throw new Error('Produto não encontrado');

  const image = await prisma.productImage.findFirst({ where: { id: imageId, productId } });
  if (!image) throw new Error('Imagem não encontrada');

  const storageKey = storageKeyFromUrl(image.url);
  if (storageKey) {
    const config = getR2Config();
    const r2 = getR2Client();
    if (config && r2) {
      await r2.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: storageKey })).catch(() => null);
    }
  } else {
    // Remover arquivo físico sem falhar se já não existir
    const absolutePath = path.join(process.cwd(), image.url);
    await fs.unlink(absolutePath).catch(() => null);
  }

  await prisma.productImage.delete({ where: { id: imageId } });

  // Se era a primária, promover a próxima
  if (image.isPrimary) {
    const next = await prisma.productImage.findFirst({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (next) {
      await prisma.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
  }
}

export async function setPrimaryProductImage(
  imageId: string,
  productId: string,
  contaId: string,
): Promise<ProductImage> {
  const product = await prisma.product.findFirst({ where: { id: productId, contaId } });
  if (!product) throw new Error('Produto não encontrado');

  const image = await prisma.productImage.findFirst({ where: { id: imageId, productId } });
  if (!image) throw new Error('Imagem não encontrada');

  await prisma.productImage.updateMany({
    where: { productId },
    data: { isPrimary: false },
  });

  return prisma.productImage.update({ where: { id: imageId }, data: { isPrimary: true } });
}

export async function reorderProductImages(
  productId: string,
  contaId: string,
  orderedIds: string[],
): Promise<void> {
  const product = await prisma.product.findFirst({ where: { id: productId, contaId } });
  if (!product) throw new Error('Produto não encontrado');

  await Promise.all(
    orderedIds.map((id, index) =>
      prisma.productImage.updateMany({
        where: { id, productId },
        data: { sortOrder: index },
      }),
    ),
  );
}
