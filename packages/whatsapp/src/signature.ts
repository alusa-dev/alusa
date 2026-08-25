import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyMetaWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  appSecret: string;
}): boolean {
  const signature = input.signatureHeader?.trim();
  if (!signature?.startsWith('sha256=') || !input.appSecret) return false;

  const provided = Buffer.from(signature.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', input.appSecret).update(input.rawBody, 'utf8').digest();
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function verifyMetaWebhookChallenge(input: {
  mode: string | null;
  token: string | null;
  challenge: string | null;
  verifyToken: string;
}): string | null {
  if (input.mode !== 'subscribe' || !input.challenge || !input.verifyToken) return null;
  return input.token === input.verifyToken ? input.challenge : null;
}
