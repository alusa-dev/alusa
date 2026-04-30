function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function getAppBaseUrl(): string {
  const configured =
    process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000';

  return trimTrailingSlash(configured);
}

export function buildAppUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return new URL(normalizedPath, `${getAppBaseUrl()}/`).toString();
}
