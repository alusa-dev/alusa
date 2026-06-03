import { createHash } from 'crypto';

export const CONTRACT_ACCEPTANCE_TEXT_V1 =
  'Declaro que li o documento e concordo com todos os termos e condições legais.';
export const CONTRACT_ACCEPTANCE_VERSION = 1;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);

  return `{${entries.join(',')}}`;
}

export function sha256Hex(value: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashCanonicalPayload(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}

export function buildSignaturePayload(input: {
  contratoId: string;
  matriculaId: string;
  contaId: string;
  hashPdf: string;
  cpf: string;
  nome: string;
  email?: string | null;
  assinadoEmIso: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  return {
    v: 1,
    acceptanceText: CONTRACT_ACCEPTANCE_TEXT_V1,
    acceptanceVersion: CONTRACT_ACCEPTANCE_VERSION,
    assinadoEm: input.assinadoEmIso,
    contaId: input.contaId,
    contratoId: input.contratoId,
    cpf: input.cpf,
    email: input.email || null,
    hashPdf: input.hashPdf,
    ip: input.ip ?? null,
    matriculaId: input.matriculaId,
    nome: input.nome,
    userAgent: input.userAgent ?? null,
  };
}
