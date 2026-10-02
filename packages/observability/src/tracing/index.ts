/** Provider-neutral span naming helpers; actual span lifecycle belongs to runtime adapters. */
export function httpSpanName(method: string, normalizedRoute: string): string {
  return `${method.toUpperCase()} ${normalizedRoute}`;
}

export function operationSpanName(domain: string, operation: string): string {
  return `${domain}.${operation}`;
}
