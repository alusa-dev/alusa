import {
  portalDashboardResultDTOSchema,
  portalEventoDTOSchema,
  portalEventosResultDTOSchema,
  portalFinanceiroDetailDTOSchema,
  portalFinanceiroListItemDTOSchema,
  portalFinanceiroListResultDTOSchema,
  portalMatriculaDTOSchema,
  portalMatriculasResultDTOSchema,
  portalNotificationsResultDTOSchema,
  portalPerfilDTOSchema,
  portalResponsavelAlunoDTOSchema,
  portalResponsavelAlunosResultDTOSchema,
} from './dtos';

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapPortalResponsavelAlunoToDTO(record: Record<string, unknown>) {
  return portalResponsavelAlunoDTOSchema.parse(record);
}

export function mapPortalResponsavelAlunosResultToDTO(record: Record<string, unknown>) {
  return portalResponsavelAlunosResultDTOSchema.parse(record);
}

export function mapPortalDashboardResultToDTO(record: Record<string, unknown>) {
  return portalDashboardResultDTOSchema.parse(record);
}

export function mapPortalEventoToDTO(record: Record<string, unknown>) {
  return portalEventoDTOSchema.parse({
    ...record,
    dataInicio: toIsoString(record.dataInicio as Date | string | undefined) ?? new Date(0).toISOString(),
    dataFim: toIsoString(record.dataFim as Date | string | undefined),
  });
}

export function mapPortalEventosResultToDTO(record: Record<string, unknown>) {
  return portalEventosResultDTOSchema.parse(record);
}

export function mapPortalFinanceiroListItemToDTO(record: Record<string, unknown>) {
  const pagamentos = Array.isArray(record.pagamentos)
    ? record.pagamentos.map((pagamento) => ({
        ...(pagamento as Record<string, unknown>),
        dataPagamento: toIsoString(
          (pagamento as Record<string, unknown>).dataPagamento as Date | string | undefined,
        ),
      }))
    : [];

  return portalFinanceiroListItemDTOSchema.parse({
    ...record,
    vencimento: toIsoString(record.vencimento as Date | string | undefined) ?? new Date(0).toISOString(),
    pagamentos,
  });
}

export function mapPortalFinanceiroListResultToDTO(record: Record<string, unknown>) {
  return portalFinanceiroListResultDTOSchema.parse(record);
}

export function mapPortalFinanceiroDetailToDTO(record: Record<string, unknown>) {
  const pagamentos = Array.isArray(record.pagamentos)
    ? record.pagamentos.map((pagamento) => ({
        ...(pagamento as Record<string, unknown>),
        dataPagamento: toIsoString(
          (pagamento as Record<string, unknown>).dataPagamento as Date | string | undefined,
        ),
      }))
    : [];

  return portalFinanceiroDetailDTOSchema.parse({
    ...record,
    vencimento: toIsoString(record.vencimento as Date | string | undefined) ?? new Date(0).toISOString(),
    pagamentos,
  });
}

export function mapPortalMatriculaToDTO(record: Record<string, unknown>) {
  return portalMatriculaDTOSchema.parse({
    ...record,
    dataInicio: toIsoString(record.dataInicio as Date | string | undefined) ?? new Date(0).toISOString(),
    dataFimContrato:
      toIsoString(record.dataFimContrato as Date | string | undefined) ?? new Date(0).toISOString(),
  });
}

export function mapPortalMatriculasResultToDTO(record: Record<string, unknown>) {
  return portalMatriculasResultDTOSchema.parse(record);
}

export function mapPortalNotificationsResultToDTO(record: Record<string, unknown>) {
  return portalNotificationsResultDTOSchema.parse(record);
}

export function mapPortalPerfilToDTO(record: Record<string, unknown>) {
  return portalPerfilDTOSchema.parse({
    ...record,
    dataNasc: toIsoString(record.dataNasc as Date | string | undefined),
  });
}
