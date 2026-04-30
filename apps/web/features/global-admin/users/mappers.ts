import {
  globalAdminUserListDTOSchema,
  globalAdminUserSupportProfileDTOSchema,
} from './dtos';

export function mapGlobalAdminUserListToDTO(record: Record<string, unknown>) {
  return globalAdminUserListDTOSchema.parse(record);
}

export function mapGlobalAdminUserSupportProfileToDTO(record: Record<string, unknown>) {
  return globalAdminUserSupportProfileDTOSchema.parse(record);
}
