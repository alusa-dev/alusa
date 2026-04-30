export type EnderecoLike = {
  endereco?: {
    cep?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
  } | null;
};

export type AlunoEnderecoFlat = {
  enderecoCep?: string | null;
  enderecoLogradouro?: string | null;
  enderecoNumero?: string | null;
  enderecoComplemento?: string | null;
  enderecoBairro?: string | null;
  enderecoCidade?: string | null;
  enderecoUf?: string | null;
};

export type ResponsavelEnderecoFlat = {
  enderecoCep?: string | null;
  enderecoLogradouro?: string | null;
  enderecoNumero?: string | null;
  enderecoComplemento?: string | null;
  enderecoBairro?: string | null;
  enderecoCidade?: string | null;
  enderecoUf?: string | null;
};

export function digits(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v);
  const only = s.replace(/\D/g, "");
  return only.length ? only : undefined;
}

export function nullifyEmpty<T extends string | null | undefined>(v: T): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v);
  return s.trim() === "" ? null : s;
}

function normalizeUf(v?: string | null): string | null | undefined {
  const s = v == null ? v : String(v).toUpperCase().slice(0, 2);
  return nullifyEmpty(s as string | null | undefined);
}

function normalizeCep(v?: string | null): string | null | undefined {
  const d = v == null ? v : digits(v);
  return d ?? nullifyEmpty(v as string | null | undefined);
}

export function flattenAlunoEndereco(input: EnderecoLike): AlunoEnderecoFlat {
  const e = input.endereco ?? undefined;
  const out: AlunoEnderecoFlat = {};
  if (!e) return out;

  const cep = normalizeCep(e.cep ?? undefined);
  const logradouro = nullifyEmpty(e.logradouro ?? undefined);
  const numero = nullifyEmpty(e.numero ?? undefined);
  const complemento = nullifyEmpty(e.complemento ?? undefined);
  const bairro = nullifyEmpty(e.bairro ?? undefined);
  const cidade = nullifyEmpty(e.cidade ?? undefined);
  const uf = normalizeUf(e.uf ?? undefined);

  if (cep !== undefined) out.enderecoCep = cep;
  if (logradouro !== undefined) out.enderecoLogradouro = logradouro;
  if (numero !== undefined) out.enderecoNumero = numero;
  if (complemento !== undefined) out.enderecoComplemento = complemento;
  if (bairro !== undefined) out.enderecoBairro = bairro;
  if (cidade !== undefined) out.enderecoCidade = cidade;
  if (uf !== undefined) out.enderecoUf = uf;

  return out;
}

export function flattenResponsavelEndereco(input: EnderecoLike): ResponsavelEnderecoFlat {
  const e = input.endereco ?? undefined;
  const out: ResponsavelEnderecoFlat = {};
  if (!e) return out;

  const cep = normalizeCep(e.cep ?? undefined);
  const logradouro = nullifyEmpty(e.logradouro ?? undefined);
  const numero = nullifyEmpty(e.numero ?? undefined);
  const complemento = nullifyEmpty(e.complemento ?? undefined);
  const bairro = nullifyEmpty(e.bairro ?? undefined);
  const cidade = nullifyEmpty(e.cidade ?? undefined);
  const uf = normalizeUf(e.uf ?? undefined);

  if (cep !== undefined) out.enderecoCep = cep;
  if (logradouro !== undefined) out.enderecoLogradouro = logradouro;
  if (numero !== undefined) out.enderecoNumero = numero;
  if (complemento !== undefined) out.enderecoComplemento = complemento;
  if (bairro !== undefined) out.enderecoBairro = bairro;
  if (cidade !== undefined) out.enderecoCidade = cidade;
  if (uf !== undefined) out.enderecoUf = uf;

  return out;
}
