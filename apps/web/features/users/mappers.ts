import {
  inviteSummaryDTOSchema,
  listUsersItemDTOSchema,
  managedUserSummaryDTOSchema,
  userProfileDTOSchema,
  userProfileWithSchoolDTOSchema,
  userSchoolAddressDTOSchema,
  userSchoolSummaryDTOSchema,
  validateInviteResultDTOSchema,
} from './dtos';

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function mapUserProfileToDTO(record: Record<string, unknown>) {
  return userProfileDTOSchema.parse(record);
}

export function mapUserProfileWithSchoolToDTO(record: Record<string, unknown>) {
  return userProfileWithSchoolDTOSchema.parse(record);
}

export function mapUserSchoolToDTO(record: Record<string, unknown>) {
  return userSchoolSummaryDTOSchema.parse(record);
}

export function mapUserSchoolAddressToDTO(record: Record<string, unknown>) {
  return userSchoolAddressDTOSchema.parse(record);
}

export function mapListUserRecordToDTO(record: Record<string, unknown>) {
  return listUsersItemDTOSchema.parse({
    ...record,
    createdAt: toIsoString(record.createdAt as Date | string | undefined) ?? new Date(0).toISOString(),
  });
}

export function mapManagedUserRecordToDTO(record: Record<string, unknown>) {
  return managedUserSummaryDTOSchema.parse(record);
}

export function mapInviteRecordToDTO(record: Record<string, unknown>) {
  return inviteSummaryDTOSchema.parse({
    ...record,
    email: record.email ? String(record.email) : null,
    createdAt: toIsoString(record.createdAt as Date | string | undefined),
    expiresAt: toIsoString(record.expiresAt as Date | string | undefined),
  });
}

export function mapInviteValidationToDTO(record: Record<string, unknown>) {
  return validateInviteResultDTOSchema.parse(record);
}
