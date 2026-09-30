/** Vercel Functions reject request bodies above 4.5 MB before route execution.
 * Keep room for multipart boundaries and fields, and enforce the limit while
 * consuming the stream when Content-Length is absent or untrusted.
 */
export const MAX_UPLOAD_REQUEST_BYTES = 4 * 1024 * 1024;

export type BoundedFormDataResult =
  | { ok: true; formData: FormData }
  | { ok: false; status: 400 | 413; error: string };

export async function readBoundedFormData(
  request: Request,
  maxBytes = MAX_UPLOAD_REQUEST_BYTES,
): Promise<BoundedFormDataResult> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, error: 'Corpo do upload excede o limite permitido.' };
  }
  if (!request.body) return { ok: false, status: 400, error: 'Corpo do upload ausente.' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413, error: 'Corpo do upload excede o limite permitido.' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: 'Não foi possível ler o corpo do upload.' };
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const replayable = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body,
    });
    return { ok: true, formData: await replayable.formData() };
  } catch {
    return { ok: false, status: 400, error: 'Formato multipart inválido.' };
  }
}

export async function readBoundedJson<T = unknown>(request: Request, maxBytes = MAX_UPLOAD_REQUEST_BYTES): Promise<
  | { ok: true; value: T }
  | { ok: false; status: 400 | 413; error: string }
> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, error: 'Corpo da requisição excede o limite permitido.' };
  }
  if (!request.body) return { ok: false, status: 400, error: 'Corpo ausente.' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413, error: 'Corpo da requisição excede o limite permitido.' };
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) as T };
  } catch {
    return { ok: false, status: 400, error: 'JSON inválido.' };
  }
}
