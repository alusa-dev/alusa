"use client";
import type { FieldErrors } from "react-hook-form";

export function digits(v?: string | null) {
  return (v ?? "").replace(/\D/g, "");
}

export function focusFirstError(errors: FieldErrors) {
  const queue: Array<[string, unknown]> = Object.entries(errors);
  while (queue.length) {
    const [key, val] = queue.shift()!;
    if (val && typeof val === "object" && "message" in (val as Record<string, unknown>)) {
      const el = document.querySelector<HTMLElement>(`[name="${key}"]`);
      if (el?.focus) el.focus();
      return;
    }
    if (val && typeof val === "object") {
      Object.entries(val as Record<string, unknown>).forEach(([k, v]) => queue.push([`${key}.${k}`, v]));
    }
  }
}

export function buildStepFieldMap() {
  return {
    identificacao: [
      "nome",
      "nomeSocial",
      "dataNasc",
      "cpf",
      "rg",
      "genero",
      "email",
      "telefone1",
      "contatoEmergenciaTelefone",
    ],
    endereco: [
      "enderecoCep",
      "enderecoLogradouro",
      "enderecoNumero",
      "enderecoComplemento",
      "enderecoBairro",
      "enderecoCidade",
      "enderecoUf",
    ],
    vinculo: [
      "cargo",
      "especialidade",
      "dataAdmissao",
      "salario",
      "status",
      "observacoes",
    ],
  foto: [],
    confirmar: [],
  } as const;
}
