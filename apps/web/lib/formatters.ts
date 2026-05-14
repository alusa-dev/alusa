export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatPhoneBR(digits: string): string {
  const v = onlyDigits(digits).slice(0, 11);
  if (v.length <= 2) return v;
  if (v.length <= 6) return `(${v.slice(0, 2)}) ${v.slice(2)}`;
  if (v.length <= 10) return `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
  return `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7, 11)}`;
}

export function formatCepBR(digits: string): string {
  const v = onlyDigits(digits).slice(0, 8);
  if (v.length <= 5) return v;
  return `${v.slice(0, 5)}-${v.slice(5)}`;
}

export function formatCpfCnpjBR(digits: string): string {
  const v = onlyDigits(digits).slice(0, 14);
  if (v.length <= 11) {
    // CPF: 000.000.000-00
    const p1 = v.slice(0, 3);
    const p2 = v.slice(3, 6);
    const p3 = v.slice(6, 9);
    const p4 = v.slice(9, 11);
    if (v.length <= 3) return p1;
    if (v.length <= 6) return `${p1}.${p2}`;
    if (v.length <= 9) return `${p1}.${p2}.${p3}`;
    return `${p1}.${p2}.${p3}-${p4}`;
  }
  // CNPJ: 00.000.000/0000-00
  const p1 = v.slice(0, 2);
  const p2 = v.slice(2, 5);
  const p3 = v.slice(5, 8);
  const p4 = v.slice(8, 12);
  const p5 = v.slice(12, 14);
  return `${p1}.${p2}.${p3}/${p4}-${p5}`;
}

export function isValidPhoneBR(digits: string): boolean {
  const v = onlyDigits(digits);
  return v.length === 10 || v.length === 11;
}

export function isValidCepBR(digits: string): boolean {
  const v = onlyDigits(digits);
  return v.length === 8;
}

function hasRepeatedDigits(value: string): boolean {
  return /^([0-9])\1+$/.test(value);
}

function isValidCpfDigits(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || hasRepeatedDigits(cpf)) return false;

  const calcDigit = (base: string, factor: number): number => {
    let total = 0;
    for (let index = 0; index < base.length; index += 1) {
      total += Number(base[index]) * (factor - index);
    }
    const mod = (total * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  return calcDigit(cpf.slice(0, 9), 10) === Number(cpf[9]) &&
    calcDigit(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

function isValidCnpjDigits(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || hasRepeatedDigits(cnpj)) return false;

  const calcDigit = (base: string, weights: number[]): number => {
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const firstDigit = calcDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondDigit = calcDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return firstDigit === Number(cnpj[12]) && secondDigit === Number(cnpj[13]);
}

export function isValidCpfCnpjBR(digits: string): boolean {
  const v = onlyDigits(digits);
  if (v.length === 11) return isValidCpfDigits(v);
  if (v.length === 14) return isValidCnpjDigits(v);
  return false;
}

export function disabledInputClasses(disabled: boolean): string | undefined {
  return disabled
    ? 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-text-muted)]'
    : 'alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)] alusa-dark:placeholder:text-[color:var(--color-input-placeholder)]';
}
