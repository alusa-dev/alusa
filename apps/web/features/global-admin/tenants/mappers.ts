import { globalAdminTenant360DTOSchema } from './dtos';

export function mapGlobalAdminTenant360ToDTO(record: Record<string, unknown>) {
  return globalAdminTenant360DTOSchema.parse(record);
}
