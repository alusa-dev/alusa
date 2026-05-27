function onlyDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

function maskMiddle(value: string, visibleStart: number, visibleEnd: number): string {
  if (!value) return '';
  if (value.length <= visibleStart + visibleEnd) return '*'.repeat(value.length);
  const suffix = visibleEnd > 0 ? value.slice(-visibleEnd) : '';
  return `${value.slice(0, visibleStart)}${'*'.repeat(value.length - visibleStart - visibleEnd)}${suffix}`;
}

export function maskCpf(value: string | null | undefined): string {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return maskMiddle(digits || String(value ?? ''), 3, 2);
  return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`;
}

export function maskCnpj(value: string | null | undefined): string {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return maskMiddle(digits || String(value ?? ''), 2, 2);
  return `${digits.slice(0, 2)}.***.***/****-${digits.slice(-2)}`;
}

export function maskEmail(value: string | null | undefined): string {
  const email = String(value ?? '').trim();
  const [local, domain] = email.split('@');
  if (!local || !domain) return maskMiddle(email, 1, 1);
  return `${maskMiddle(local, Math.min(2, local.length), 0)}@${domain}`;
}

export function maskPhone(value: string | null | undefined): string {
  const digits = onlyDigits(value);
  if (digits.length < 8) return maskMiddle(digits || String(value ?? ''), 2, 2);
  return `${digits.slice(0, 2)}*****${digits.slice(-4)}`;
}

export function maskAddress(value: string | null | undefined): string {
  const address = String(value ?? '').trim();
  if (!address) return '';
  const [firstPart] = address.split(',');
  return firstPart ? `${firstPart.trim()}, ***` : '***';
}

export function maskPixKey(value: string | null | undefined): string {
  const pixKey = String(value ?? '').trim();
  if (!pixKey) return '';
  if (pixKey.includes('@')) return maskEmail(pixKey);
  const digits = onlyDigits(pixKey);
  if (digits.length === 11) return maskCpf(digits);
  if (digits.length === 14) return maskCnpj(digits);
  if (digits.length >= 8) return maskPhone(digits);
  return maskMiddle(pixKey, 3, 3);
}

export function maskSensitiveValue(field: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const key = field.toLowerCase();
  if (key.includes('cpf')) return maskCpf(value);
  if (key.includes('cnpj')) return maskCnpj(value);
  if (key.includes('email')) return maskEmail(value);
  if (key.includes('telefone') || key.includes('phone')) return maskPhone(value);
  if (key.includes('endereco') || key.includes('address')) return maskAddress(value);
  if (key.includes('pix')) return maskPixKey(value);
  if (key.includes('token') || key.includes('secret') || key.includes('authorization')) return '[REDACTED]';
  return value;
}
