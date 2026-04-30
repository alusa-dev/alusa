import {
  globalAdminErrorLogResultDTOSchema,
  globalAdminRequestLogResultDTOSchema,
  globalAdminWebhookLogResultDTOSchema,
} from './dtos';

export function mapGlobalAdminRequestLogResultToDTO(record: Record<string, unknown>) {
  return globalAdminRequestLogResultDTOSchema.parse(record);
}

export function mapGlobalAdminWebhookLogResultToDTO(record: Record<string, unknown>) {
  return globalAdminWebhookLogResultDTOSchema.parse(record);
}

export function mapGlobalAdminErrorLogResultToDTO(record: Record<string, unknown>) {
  return globalAdminErrorLogResultDTOSchema.parse(record);
}
