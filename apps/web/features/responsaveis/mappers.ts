import type {
  CreateResponsavelInputDTO,
  ListResponsaveisQueryDTO,
  ResponsavelSummaryDTO,
} from './dtos';

type ResponsavelSummaryRecord = {
  id: string;
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  financeiro: boolean;
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

export function mapCreateResponsavelDTOToData(
  dto: CreateResponsavelInputDTO,
  contaId: string,
) {
  return {
    contaId,
    nome: dto.nome,
    cpf: onlyDigits(dto.cpf),
    email: dto.email || `temp_${Date.now()}@responsavel.local`,
    telefone: dto.telefone ? onlyDigits(dto.telefone) : '',
    financeiro: dto.financeiro ?? true,
  };
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
  };
}
