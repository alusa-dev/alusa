import { globalAdminActionResultDTOSchema } from './dtos';

export function mapGlobalAdminActionResultToDTO(record: Record<string, unknown>) {
  return globalAdminActionResultDTOSchema.parse(record);
}
