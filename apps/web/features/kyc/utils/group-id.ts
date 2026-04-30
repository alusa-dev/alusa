export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const MAX_GROUP_ID_LEN = 200;

export function isValidKycGroupId(groupId: unknown): groupId is string {
  if (typeof groupId !== 'string') return false;
  const normalized = groupId.trim();
  if (!normalized) return false;
  if (normalized.length > MAX_GROUP_ID_LEN) return false;
  if (normalized === ZERO_UUID) return false;
  // Identificadores do provedor devem ser tratados como opacos. Bloqueamos apenas
  // valores que quebrariam o path param (ex.: contém "/") ou espaços.
  if (/[\s/]/.test(normalized)) return false;
  return true;
}
