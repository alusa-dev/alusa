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

export function isValidCpfCnpjBR(digits: string): boolean {
  const v = onlyDigits(digits);
  return v.length === 11 || v.length === 14;
}

export function disabledInputClasses(disabled: boolean): string | undefined {
  return disabled ? 'bg-gray-50 text-gray-500 border-gray-200 cursor-not-allowed' : undefined;
}

