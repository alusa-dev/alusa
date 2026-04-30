export const isAuthDebug = process.env.NEXT_PUBLIC_AUTH_DEBUG === '1' || process.env.AUTH_DEBUG === '1';

export function debugLog(scope: string, msg: string, extra?: unknown) {
  if (!isAuthDebug) return;
  console.log(`[AUTH][${new Date().toISOString()}][${scope}] ${msg}`, extra ?? '');
}
