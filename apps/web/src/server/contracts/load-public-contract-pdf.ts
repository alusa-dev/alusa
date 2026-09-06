import { getStorageObject, isR2Configured, storageKeyFromUrl } from '@/lib/r2-storage';

/**
 * Loads a contract source PDF directly from tenant-scoped storage.
 *
 * Public signers do not have an authenticated Alusa session. Calling the
 * protected `/api/files` route from the signing handler therefore returns 404
 * even though the browser may have been able to preview the same document.
 * This adapter keeps the storage credentials server-side and returns null for
 * URLs that belong to another source (for example, an external HTTPS URL), so
 * the contract use case can retain its existing HTTP fallback.
 */
export async function loadPublicContractPdf(url: string): Promise<Buffer | null> {
  const key = storageKeyFromUrl(url);
  if (!key || !isR2Configured()) return null;

  const object = await getStorageObject(key);
  if (!object.Body) return null;
  const bytes = await object.Body.transformToByteArray();
  return bytes.byteLength ? Buffer.from(bytes) : null;
}
