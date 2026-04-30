import { globalAdminSearchResultDTOSchema } from './dtos';

export function mapGlobalAdminSearchResultToDTO(record: Record<string, unknown>) {
  return globalAdminSearchResultDTOSchema.parse(record);
}
