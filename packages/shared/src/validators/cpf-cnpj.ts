export type PersonType = 'PF' | 'PJ' | 'UNKNOWN';

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeCpfCnpjDigits(value: string | null | undefined): string {
  return onlyDigits(value ?? '');
}

export function detectPersonType(cpfCnpj: string | null | undefined): PersonType {
  const digits = normalizeCpfCnpjDigits(cpfCnpj);
  if (digits.length === 11) return 'PF';
  if (digits.length === 14) return 'PJ';
  return 'UNKNOWN';
}

function isRepeatedDigits(value: string): boolean {
  return /^([0-9])\1+$/.test(value);
}

export function isValidCpfDigits(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || isRepeatedDigits(cpf)) return false;

  const calculateDigit = (base: string, factor: number): number => {
    let total = 0;
    for (let index = 0; index < base.length; index += 1) {
      total += Number(base[index]) * (factor - index);
    }
    const mod = (total * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  return (
    calculateDigit(cpf.slice(0, 9), 10) === Number(cpf[9]) &&
    calculateDigit(cpf.slice(0, 10), 11) === Number(cpf[10])
  );
}

export function isValidCnpjDigits(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || isRepeatedDigits(cnpj)) return false;

  const calculateDigit = (base: string, weights: number[]): number => {
    const total = weights.reduce((sum, weight, index) => sum + Number(base[index]) * weight, 0);
    const mod = total % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const secondWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  return (
    calculateDigit(cnpj.slice(0, 12), firstWeights) === Number(cnpj[12]) &&
    calculateDigit(cnpj.slice(0, 13), secondWeights) === Number(cnpj[13])
  );
}

export function isValidCpfCnpjDigits(value: string | null | undefined): boolean {
  const digits = normalizeCpfCnpjDigits(value);
  if (digits.length === 11) return isValidCpfDigits(digits);
  if (digits.length === 14) return isValidCnpjDigits(digits);
  return false;
}

/** Formata o documento sem incorporar regra de apresentação de um app. */
export function maskCpfCnpj(value: string | null | undefined): string {
  const digits = normalizeCpfCnpjDigits(value);
  if (digits.length <= 11) {
    const first = digits.slice(0, 3);
    const second = digits.slice(3, 6);
    const third = digits.slice(6, 9);
    const check = digits.slice(9, 11);
    if (digits.length <= 3) return first;
    if (digits.length <= 6) return `${first}.${second}`;
    if (digits.length <= 9) return `${first}.${second}.${third}`;
    return `${first}.${second}.${third}-${check}`;
  }

  const first = digits.slice(0, 2);
  const second = digits.slice(2, 5);
  const third = digits.slice(5, 8);
  const branch = digits.slice(8, 12);
  const check = digits.slice(12, 14);
  if (digits.length <= 2) return first;
  if (digits.length <= 5) return `${first}.${second}`;
  if (digits.length <= 8) return `${first}.${second}.${third}`;
  if (digits.length <= 12) return `${first}.${second}.${third}/${branch}`;
  return `${first}.${second}.${third}/${branch}-${check}`;
}
