import { z } from "zod";

const errorMap: z.ZodErrorMap = (issue, ctx) => {
  const last = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path[issue.path.length - 1] : undefined;
  const fieldKey = typeof last === "string" ? last.toLowerCase() : "";
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type: {
      // required
      if (issue.received === "undefined" || issue.received === "null") {
        return { message: "Este campo é obrigatório." };
      }
      return { message: ctx.defaultError };
    }
    case z.ZodIssueCode.invalid_string: {
      // formatos comuns
      switch (issue.validation) {
        case "email":
          return { message: "Digite um e-mail válido." };
        case "url":
          return { message: "Digite uma URL válida." };
        case "uuid":
        case "cuid":
        case "cuid2":
        case "ulid":
          return { message: "Digite um identificador válido." };
        case "regex": {
          // Heurísticas por nome de campo
          if (fieldKey.includes("cep")) return { message: "Digite um CEP válido." };
          if (fieldKey.includes("cpfcnpj") || fieldKey.includes("cpf_cnpj")) return { message: "Digite um CPF ou CNPJ válido." };
          if (fieldKey.includes("cpf")) return { message: "Digite um CPF válido." };
          if (fieldKey.includes("cnpj")) return { message: "Digite um CNPJ válido." };
          if (fieldKey.includes("telefone") || fieldKey.includes("cel") || fieldKey.includes("phone")) return { message: "Digite um telefone válido." };
          if (fieldKey === "uf" || fieldKey.includes("estado")) return { message: "Digite uma UF válida (2 letras)." };
          return { message: "Formato inválido." };
        }
        case "emoji":
        case "ip":
          return { message: "Formato inválido." };
        case "datetime":
          return { message: "Data e hora inválidas." };
        default:
          return { message: ctx.defaultError };
      }
    }
    case z.ZodIssueCode.too_small: {
      if (issue.type === "string") {
        if (fieldKey === "uf" && issue.minimum >= 2) {
          return { message: "UF deve ter 2 letras." };
        }
        return { message: `Preencha este campo (mínimo ${issue.minimum} caracteres).` };
      }
      if (issue.type === "array" || issue.type === "set") {
        return { message: `Selecione ao menos ${issue.minimum} item(s).` };
      }
      if (issue.type === "number") {
        const base = issue.inclusive ? "maior ou igual a" : "maior que";
        return { message: `Informe um valor ${base} ${issue.minimum}.` };
      }
      return { message: ctx.defaultError };
    }
    case z.ZodIssueCode.too_big: {
      if (issue.type === "string") {
        if (fieldKey === "uf" && issue.maximum <= 2) {
          return { message: "UF deve ter 2 letras." };
        }
        return { message: `O valor não pode ultrapassar ${issue.maximum} caracteres.` };
      }
      if (issue.type === "array" || issue.type === "set") {
        return { message: `Selecione no máximo ${issue.maximum} item(s).` };
      }
      if (issue.type === "number") {
        const base = issue.inclusive ? "menor ou igual a" : "menor que";
        return { message: `Informe um valor ${base} ${issue.maximum}.` };
      }
      return { message: ctx.defaultError };
    }
    case z.ZodIssueCode.not_multiple_of: {
      return { message: `Informe um valor múltiplo de ${issue.multipleOf}.` };
    }
    case z.ZodIssueCode.invalid_enum_value: {
      return { message: "Selecione uma opção válida." };
    }
    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_union_discriminator:
    case z.ZodIssueCode.invalid_intersection_types:
    case z.ZodIssueCode.invalid_literal: {
      return { message: "Valor inválido." };
    }
    case z.ZodIssueCode.invalid_date: {
      return { message: "Data inválida." };
    }
    case z.ZodIssueCode.not_finite: {
      return { message: "Digite um número válido." };
    }
    case z.ZodIssueCode.custom: {
      // respeita mensagens personalizadas quando fornecidas
      return { message: ctx.defaultError };
    }
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(errorMap);

export { errorMap };
