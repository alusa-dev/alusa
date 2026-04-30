import { globalAdminAuditLogResultDTOSchema } from './dtos';

export function mapGlobalAdminAuditLogResultToDTO(record: Record<string, unknown>) {
  return globalAdminAuditLogResultDTOSchema.parse(record);
}
