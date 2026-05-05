import type {
  CreateResponsavelInputDTO,
  ListResponsaveisQueryDTO,
  ResponsavelDetailDTO,
  ResponsavelSummaryDTO,
  UpdateResponsavelInputDTO,
} from './dtos';

type ResponsavelSummaryRecord = {
  id: string;
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  financeiro: boolean;
  _count?: {
    alunos?: number;
  };
};

type ResponsavelDetailRecord = ResponsavelSummaryRecord & {
  asaasCustomerId: string | null;
  usuarioId: string | null;
  enderecoCep: string | null;
  enderecoLogradouro: string | null;
  enderecoNumero: string | null;
  enderecoComplemento: string | null;
  enderecoBairro: string | null;
  enderecoCidade: string | null;
  enderecoUf: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  _count?: {
    alunos?: number;
    matriculasFinanceiras?: number;
    sales?: number;
  };
};

export type ListResponsaveisFilters = {
  contaId: string;
  search?: string;
  cpfDigits?: string;
  take: number;
};

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

export function mapListResponsaveisQueryToFilters(
  dto: ListResponsaveisQueryDTO,
  contaId: string,
): ListResponsaveisFilters {
  const search = dto.q?.trim();
  const cpfDigits = search ? onlyDigits(search) : undefined;
  return {
    contaId,
    search: search || undefined,
    cpfDigits: cpfDigits || undefined,
    take: 50,
  };
}

export function mapCreateResponsavelDTOToData(dto: CreateResponsavelInputDTO, contaId: string) {
  return {
    contaId,
    nome: dto.nome,
    cpf: onlyDigits(dto.cpf),
    email: dto.email || `temp_${Date.now()}@responsavel.local`,
    telefone: dto.telefone ? onlyDigits(dto.telefone) : '',
    financeiro: dto.financeiro ?? true,
  };
}

export function mapUpdateResponsavelDTOToData(dto: UpdateResponsavelInputDTO) {
  const data: Record<string, unknown> = {};

  if (typeof dto.nome === 'string') data.nome = dto.nome.trim();
  if (typeof dto.cpf === 'string') data.cpf = onlyDigits(dto.cpf);
  if (typeof dto.email === 'string') data.email = dto.email.trim() || undefined;
  if (typeof dto.telefone === 'string') data.telefone = onlyDigits(dto.telefone);
  if (typeof dto.financeiro === 'boolean') data.financeiro = dto.financeiro;
  if (dto.endereco && typeof dto.endereco === 'object') {
    if (typeof dto.endereco.cep === 'string') data.enderecoCep = dto.endereco.cep.trim();
    if (typeof dto.endereco.logradouro === 'string') data.enderecoLogradouro = dto.endereco.logradouro.trim();
    if (typeof dto.endereco.numero === 'string') data.enderecoNumero = dto.endereco.numero.trim();
    if (typeof dto.endereco.complemento === 'string') data.enderecoComplemento = dto.endereco.complemento.trim();
    if (typeof dto.endereco.bairro === 'string') data.enderecoBairro = dto.endereco.bairro.trim();
    if (typeof dto.endereco.cidade === 'string') data.enderecoCidade = dto.endereco.cidade.trim();
    if (typeof dto.endereco.uf === 'string') data.enderecoUf = dto.endereco.uf.trim().toUpperCase();
  }

  return data;
}

export function mapResponsavelRecordToSummaryDTO(
  record: ResponsavelSummaryRecord,
): ResponsavelSummaryDTO {
  return {
    id: record.id,
    nome: record.nome,
    cpf: record.cpf,
    email: record.email,
    telefone: record.telefone,
    financeiro: record.financeiro,
    alunosCount: record._count?.alunos ?? 0,
  };
}

export function mapResponsavelRecordToDetailDTO(
  record: ResponsavelDetailRecord,
): ResponsavelDetailDTO {
  return {
    ...mapResponsavelRecordToSummaryDTO(record),
    asaasCustomerId: record.asaasCustomerId ?? null,
    usuarioId: record.usuarioId ?? null,
    endereco: {
      cep: record.enderecoCep ?? null,
      logradouro: record.enderecoLogradouro ?? null,
      numero: record.enderecoNumero ?? null,
      complemento: record.enderecoComplemento ?? null,
      bairro: record.enderecoBairro ?? null,
      cidade: record.enderecoCidade ?? null,
      uf: record.enderecoUf ?? null,
    },
    metrics: {
      alunos: record._count?.alunos ?? 0,
      matriculasFinanceiras: record._count?.matriculasFinanceiras ?? 0,
      vendas: record._count?.sales ?? 0,
    },
    createdAt: record.createdAt ? record.createdAt.toISOString() : null,
    updatedAt: record.updatedAt ? record.updatedAt.toISOString() : null,
  };
}
