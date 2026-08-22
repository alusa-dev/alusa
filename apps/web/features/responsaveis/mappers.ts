import type {
  CreateResponsavelInputDTO,
  ListResponsaveisQueryDTO,
  ResponsavelDetailDTO,
  ResponsavelSummaryDTO,
  UpdateResponsavelInputDTO,
} from './dtos';
import {
  assertPayerAddressFiscalReady,
  mapNormalizedAddressToResponsavelColumns,
  normalizePayerAddressInput,
  trimOrUndefined,
} from '@alusa/lib';
import { maskCpf, maskEmail, maskPhone } from '@alusa/shared';

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
  status: 'TODOS' | 'ATIVO' | 'INATIVO';
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
    status: dto.status,
    take: 50,
  };
}

export function mapCreateResponsavelDTOToData(dto: CreateResponsavelInputDTO, contaId: string) {
  const financeiro = dto.financeiro ?? true;
  const base = {
    contaId,
    nome: dto.nome,
    cpf: onlyDigits(dto.cpf),
    email: dto.email || `temp_${Date.now()}@responsavel.local`,
    telefone: dto.telefone ? onlyDigits(dto.telefone) : '',
    financeiro,
  };

  if (!dto.endereco) {
    return base;
  }

  const normalized = financeiro
    ? assertPayerAddressFiscalReady(dto.endereco)
    : normalizePayerAddressInput(dto.endereco);

  if (!normalized) {
    return base;
  }

  return {
    ...base,
    ...mapNormalizedAddressToResponsavelColumns(normalized),
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
    const normalized = normalizePayerAddressInput({
      cep: trimOrUndefined(dto.endereco.cep),
      logradouro: trimOrUndefined(dto.endereco.logradouro),
      numero: trimOrUndefined(dto.endereco.numero),
      complemento: trimOrUndefined(dto.endereco.complemento),
      bairro: trimOrUndefined(dto.endereco.bairro),
      cidade: trimOrUndefined(dto.endereco.cidade),
      uf: trimOrUndefined(dto.endereco.uf),
    });

    if (normalized) {
      Object.assign(data, mapNormalizedAddressToResponsavelColumns(normalized));
    } else {
      if (typeof dto.endereco.cep === 'string') data.enderecoCep = dto.endereco.cep.trim() || null;
      if (typeof dto.endereco.logradouro === 'string') {
        data.enderecoLogradouro = dto.endereco.logradouro.trim() || null;
      }
      if (typeof dto.endereco.numero === 'string') data.enderecoNumero = dto.endereco.numero.trim() || null;
      if (typeof dto.endereco.complemento === 'string') {
        data.enderecoComplemento = dto.endereco.complemento.trim() || null;
      }
      if (typeof dto.endereco.bairro === 'string') data.enderecoBairro = dto.endereco.bairro.trim() || null;
      if (typeof dto.endereco.cidade === 'string') data.enderecoCidade = dto.endereco.cidade.trim() || null;
      if (typeof dto.endereco.uf === 'string') data.enderecoUf = dto.endereco.uf.trim().toUpperCase() || null;
    }
  }

  return data;
}

export function mapResponsavelRecordToSummaryDTO(
  record: ResponsavelSummaryRecord,
): ResponsavelSummaryDTO {
  const cpfMasked = maskCpf(record.cpf);
  const emailMasked = maskEmail(record.email);
  const phoneMasked = maskPhone(record.telefone);

  return {
    id: record.id,
    nome: record.nome,
    cpf: record.cpf,
    email: record.email,
    telefone: record.telefone,
    cpfMasked,
    emailMasked,
    phoneMasked,
    financeiro: record.financeiro,
    alunosCount: record._count?.alunos ?? 0,
  };
}

export function mapResponsavelRecordToMaskedSummaryDTO(
  record: ResponsavelSummaryRecord,
): ResponsavelSummaryDTO {
  const dto = mapResponsavelRecordToSummaryDTO(record);
  return {
    ...dto,
    cpf: dto.cpfMasked ?? '',
    email: dto.email,
    telefone: dto.telefone,
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
