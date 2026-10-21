/** Format date-only values as civil dates, without converting them through UTC. */
export function formatCivilDate(value?: string | Date | null): string {
  if (!value) return '—';
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00:00(?:\.000)?Z$)/.exec(value);
    if (match) {
      const [, year, month, day] = match;
      const civil = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (
        civil.getUTCFullYear() !== Number(year) ||
        civil.getUTCMonth() !== Number(month) - 1 ||
        civil.getUTCDate() !== Number(day)
      ) return '—';
      return `${day}/${month}/${year}`;
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR');
}
