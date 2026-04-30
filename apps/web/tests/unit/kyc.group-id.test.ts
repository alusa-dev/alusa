import { describe, expect, it } from 'vitest';

import { isValidKycGroupId, ZERO_UUID } from '@/features/kyc/utils/group-id';

describe('isValidKycGroupId', () => {
  it('aceita UUID válido', () => {
    expect(isValidKycGroupId('8d257732-2220-41ec-b695-b6af4a64184d')).toBe(true);
  });

  it('aceita identificador opaco grp_*', () => {
    expect(isValidKycGroupId('grp_1')).toBe(true);
    expect(isValidKycGroupId('grp_upload_document_01')).toBe(true);
  });

  it('rejeita ZERO_UUID porque o grupo ainda não está provisionado', () => {
    expect(isValidKycGroupId(ZERO_UUID)).toBe(false);
  });

  it('rejeita valores inválidos', () => {
    expect(isValidKycGroupId('a b')).toBe(false);
    expect(isValidKycGroupId('a/b')).toBe(false);
    expect(isValidKycGroupId('')).toBe(false);
    expect(isValidKycGroupId(null)).toBe(false);
  });
});
