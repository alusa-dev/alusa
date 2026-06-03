export function formatCurrencyInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const intVal = parseInt(digits, 10);
  return (intVal / 100).toFixed(2).replace('.', ',');
}

export function parseCurrencyInput(str: string): number {
  if (!str.trim()) return 0;
  const normalized = str.replace(/\./g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}
