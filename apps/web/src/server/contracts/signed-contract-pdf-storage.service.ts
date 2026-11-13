import { createHash, randomUUID } from 'node:crypto';
import { deleteStorageObject, getStorageObject, isR2Configured, putStorageObject } from '@/lib/r2-storage';

const SIGNED_PDF_PREFIX = 'uploads/contracts/signed';

export async function storeSignedContractPdf(input: {
  contaId: string;
  contractId: string;
  bytes: Buffer;
  sha256: string;
}) {
  if (!isR2Configured()) throw new Error('SIGNED_PDF_STORAGE_UNAVAILABLE');
  const storageKey = `${SIGNED_PDF_PREFIX}/${input.contaId}/${input.contractId}/${randomUUID()}.pdf`;
  await putStorageObject({
    key: storageKey,
    body: input.bytes,
    contentType: 'application/pdf',
    contentLength: input.bytes.byteLength,
    metadata: { sha256: input.sha256 },
  });
  return storageKey;
}

export async function deleteSignedContractPdf(storageKey: string) {
  if (!storageKey.startsWith(`${SIGNED_PDF_PREFIX}/`)) {
    throw new Error('SIGNED_PDF_STORAGE_KEY_INVALID');
  }
  await deleteStorageObject(storageKey);
}

export async function loadSignedContractPdf(input: {
  contaId: string;
  contractId: string;
  storageKey: string | null;
  arquivoUrl: string;
  sha256: string;
}): Promise<Buffer | null> {
  let bytes: Buffer | null = null;

  if (input.storageKey) {
    const expectedPrefix = `${SIGNED_PDF_PREFIX}/${input.contaId}/${input.contractId}/`;
    const objectName = input.storageKey.startsWith(expectedPrefix)
      ? input.storageKey.slice(expectedPrefix.length)
      : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i.test(objectName)) {
      throw new Error('SIGNED_PDF_STORAGE_KEY_INVALID');
    }
    const object = await getStorageObject(input.storageKey);
    if (!object.Body) return null;
    bytes = Buffer.from(await object.Body.transformToByteArray());
  } else {
    const match = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.arquivoUrl);
    if (!match) return null;
    bytes = Buffer.from(match[1], 'base64');
  }

  if (bytes.byteLength < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('SIGNED_PDF_INVALID_CONTENT');
  }
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== input.sha256) throw new Error('SIGNED_PDF_HASH_MISMATCH');
  return bytes;
}
