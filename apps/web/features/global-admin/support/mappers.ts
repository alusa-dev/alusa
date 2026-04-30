import { globalAdminSupportCaseResultDTOSchema } from './dtos';

export function mapGlobalAdminSupportCaseResultToDTO(record: Record<string, unknown>) {
  return globalAdminSupportCaseResultDTOSchema.parse(record);
}
