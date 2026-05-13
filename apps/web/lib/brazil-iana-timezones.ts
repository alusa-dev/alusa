/** Fusos IANA usados por escolas no Brasil (agenda / turmas). Lista curada para o seletor de UI. */
export const BRAZIL_IANA_TIMEZONE_OPTIONS = [
  { value: 'America/Sao_Paulo', label: 'Brasília / Sudeste / Sul (America/Sao_Paulo)' },
  { value: 'America/Manaus', label: 'Amazonas (America/Manaus)' },
  { value: 'America/Rio_Branco', label: 'Acre (America/Rio_Branco)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (America/Noronha)' },
] as const;

export function isValidIanaTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}
