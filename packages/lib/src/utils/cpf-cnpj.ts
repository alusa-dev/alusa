export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeCpfCnpjDigits(value: string): string {
  return onlyDigits(value);
}

function isRepeatedDigits(value: string): boolean {
  return /^([0-9])\1+$/.test(value);
}

export function isValidCpfDigits(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (isRepeatedDigits(cpf)) return false;

  const calcDigit = (base: string, factor: number): number => {
    let total = 0;
    for (let i = 0; i < base.length; i += 1) {
      total += Number(base[i]) * (factor - i);
    }
    const mod = (total * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const d1 = calcDigit(cpf.slice(0, 9), 10);
  const d2 = calcDigit(cpf.slice(0, 10), 11);

  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

export function isValidCnpjDigits(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14) return false;
  if (isRepeatedDigits(cnpj)) return false;

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const calc = (base: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i += 1) {
      sum += Number(base[i]) * weights[i];
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calc(cnpj.slice(0, 12), weights1);
  const d2 = calc(cnpj.slice(0, 13), weights2);

  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

export function isValidCpfCnpjDigits(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length === 11) return isValidCpfDigits(digits);
  if (digits.length === 14) return isValidCnpjDigits(digits);
  return false;
}

export function maskCpfCnpj(value: string | null | undefined): string {
  const input = value ?? '';
  const digits = onlyDigits(input);

  if (digits.length <= 11) {
    // CPF: 000.000.000-00
    const a = digits.slice(0, 3);
    const b = digits.slice(3, 6);
    const c = digits.slice(6, 9);
    const d = digits.slice(9, 11);

    if (digits.length <= 3) return a;
    if (digits.length <= 6) return `${a}.${b}`;
    if (digits.length <= 9) return `${a}.${b}.${c}`;
    return `${a}.${b}.${c}-${d}`;
  }

  // CNPJ: 00.000.000/0000-00
  const a = digits.slice(0, 2);
  const b = digits.slice(2, 5);
  const c = digits.slice(5, 8);
  const d = digits.slice(8, 12);
  const e = digits.slice(12, 14);

  if (digits.length <= 2) return a;
  if (digits.length <= 5) return `${a}.${b}`;
  if (digits.length <= 8) return `${a}.${b}.${c}`;
  if (digits.length <= 12) return `${a}.${b}.${c}/${d}`;
  return `${a}.${b}.${c}/${d}-${e}`;
}
