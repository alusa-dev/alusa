function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function getAppBaseUrl(): string {
  const configured =
    process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';

  return trimTrailingSlash(configured);
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    return true;
  }

  const octets = normalized.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }

  return octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

/** Resolve the origin used in invite links for the current deployment. */
export function getInviteBaseUrl(): string {
  if (process.env.NODE_ENV === 'test') return getAppBaseUrl();

  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;
  const configured = process.env.NODE_ENV === 'production'
    ? process.env.INVITE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || vercelUrl || process.env.NEXTAUTH_URL
    : process.env.INVITE_BASE_URL || 'http://localhost:3000';

  if (!configured) {
    throw new Error('Configure a URL base para gerar convites.');
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('A URL pública configurada para convites é inválida.');
  }

  const isLocalDevelopment = process.env.NODE_ENV !== 'production' && isPrivateOrLocalHostname(parsed.hostname);
  if ((!isLocalDevelopment && parsed.protocol !== 'https:') || (process.env.NODE_ENV === 'production' && isPrivateOrLocalHostname(parsed.hostname))) {
    throw new Error('Em desenvolvimento, use localhost; em produção, convites exigem um domínio público HTTPS.');
  }

  return parsed.origin;
}

export function buildAppUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return new URL(normalizedPath, `${getAppBaseUrl()}/`).toString();
}

/** Build a URL intended to be opened from an email or another external client. */
export function buildPublicAppUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return new URL(normalizedPath, `${getInviteBaseUrl()}/`).toString();
}
