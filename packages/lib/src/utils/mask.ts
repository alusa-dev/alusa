export function maskCpf(value: string | null | undefined): string {
  const input = value ?? '';
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 11) {
    return input;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function maskPhone(value: string | null | undefined): string {
  const input = value ?? '';
  const digits = input.replace(/\D/g, '');
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

export function maskCep(value: string | null | undefined): string {
  const input = value ?? '';
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 8) {
    return input;
  }
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export { maskCpfCnpj } from './cpf-cnpj';
