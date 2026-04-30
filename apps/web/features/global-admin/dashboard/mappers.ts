import { globalAdminDashboardDTOSchema } from './dtos';

export function mapGlobalAdminDashboardToDTO(record: Record<string, unknown>) {
  return globalAdminDashboardDTOSchema.parse(record);
}
