'use client';

export function isValidCPF(cpf: string): boolean {
  if (!cpf) return true; // CPF é opcional

  const cleaned = cpf.replace(/\D/g, '');

  if (cleaned.length !== 11) return false;

  // Verifica se todos os dígitos são iguais
  if (/^(\d)\1{10}$/.test(cleaned)) return false;

  // Validação dos dígitos verificadores
  const calc = (base: string, factor: number): number => {
    let total = 0;
    for (let i = 0; i < base.length; i++) {
      total += parseInt(base[i]!, 10) * (factor - i);
    }
    const rest = total % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const d1 = calc(cleaned.substring(0, 9), 10);
  const d2 = calc(cleaned.substring(0, 10), 11);

  return d1 === parseInt(cleaned[9]!, 10) && d2 === parseInt(cleaned[10]!, 10);
}

export function formatCPF(cpf: string): string {
  const cleaned = cpf.replace(/\D/g, '');
  return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

export function isValidTelefone(telefone: string): boolean {
  if (!telefone) return true; // Telefone opcional em alguns casos
  const digits = telefone.replace(/\D/g, '');
  // Exigir padrão móvel brasileiro: 11 dígitos (DDD + 9 + 8 dígitos)
  return /^\d{11}$/.test(digits);
}

export function isValidCEP(cep: string): boolean {
  if (!cep) return false; // CEP é obrigatório

  const cepRegex = /^(\d{5}-?\d{3})$/;
  return cepRegex.test(cep);
}
