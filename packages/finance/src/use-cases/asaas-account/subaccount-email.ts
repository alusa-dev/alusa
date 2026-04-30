function normalizeTrimmedEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeComparableEmail(value: string | null | undefined): string | null {
  const normalized = normalizeTrimmedEmail(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function resolveCanonicalSubaccountEmail(ownerEmail: string | null | undefined): string | null {
  return normalizeTrimmedEmail(ownerEmail);
}

/**
 * @deprecated Apenas para reconciliação de subcontas legadas criadas com email aliasado.
 * Novas subcontas sempre usam o email canônico do dono.
 */
export function deriveLegacyAliasedSubaccountEmail(baseEmail: string, contaId: string): string {
  const trimmed = baseEmail.trim();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return trimmed;

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);

  const localBase = local.split('+')[0] ?? local;
  const safeSuffix = contaId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  const tag = safeSuffix ? `alusa-${safeSuffix}` : 'alusa';

  return `${localBase}+${tag}@${domain}`;
}

export function matchesSubaccountEmail(params: {
  remoteEmail: string | null | undefined;
  remoteLoginEmail: string | null | undefined;
  canonicalEmail: string | null | undefined;
  legacyAliasedEmail?: string | null | undefined;
}): boolean {
  const expectedEmails = new Set(
    [params.canonicalEmail, params.legacyAliasedEmail]
      .map((value) => normalizeComparableEmail(value))
      .filter((value): value is string => Boolean(value)),
  );

  if (expectedEmails.size === 0) return false;

  const remoteEmail = normalizeComparableEmail(params.remoteEmail);
  const remoteLoginEmail = normalizeComparableEmail(params.remoteLoginEmail);

  return (remoteEmail !== null && expectedEmails.has(remoteEmail))
    || (remoteLoginEmail !== null && expectedEmails.has(remoteLoginEmail));
}

export function needsSubaccountEmailSync(
  persistedEmail: string | null | undefined,
  canonicalEmail: string | null | undefined,
): boolean {
  const expected = normalizeComparableEmail(canonicalEmail);
  if (!expected) return false;

  return normalizeComparableEmail(persistedEmail) !== expected;
}
