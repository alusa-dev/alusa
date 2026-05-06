"use client";
import type { FieldErrors } from "react-hook-form";

export function digits(v?: string | null) {
  return (v ?? "").replace(/\D/g, "");
}

export function parseMaybeDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

export function yearsDiff(from: Date, to = new Date()) {
  let y = to.getFullYear() - from.getFullYear();
  const m = to.getMonth() - from.getMonth();
  if (m < 0 || (m === 0 && to.getDate() < from.getDate())) y--;
  return y;
}

export async function fileToBase64(file: File): Promise<string> {
  const buff = await file.arrayBuffer();
  const bytes = new Uint8Array(buff);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return `data:${file.type};base64,${btoa(binary)}`;
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
      Object.entries(val as Record<string, unknown>).forEach(([k, v]) =>
        queue.push([`${key}.${k}`, v])
      );
    }
  }
}

export function buildStepFieldMap(isMinor: boolean) {
  return {
    identificacao: [
      "nome",
      "dataNasc",
      "email",
      "telefone",
      "cpf",
      "genero",
      "status",
    ],
    endereco: [
      "enderecoCep",
      "enderecoLogradouro",
      "enderecoNumero",
      "enderecoComplemento",
      "enderecoBairro",
      "enderecoCidade",
      "enderecoUf",
      "observacao",
    ],
    saude: [
      "alergias",
      "restricoesMedicas",
      "contatoEmergenciaNome",
      "contatoEmergenciaTelefone",
    ],
    perfil: [
      "modalidadePrincipal",
      "nivel",
      "origemCadastro",
      "tamanhoCamiseta",
      "tamanhoCalcado",
      "tags",
      "consentimentoImagem",
      "consentimentoComunicacoes",
    ],
    foto: [],
    responsavel: isMinor
      ? [
          "responsavelModo",
          "responsavelExistenteId",
          "responsavel.nome",
          "responsavel.cpf",
          "responsavel.email",
          "responsavel.telefone",
          "responsavel.enderecoCep",
        ]
      : [],
    confirmar: [],
  } as const;
}
