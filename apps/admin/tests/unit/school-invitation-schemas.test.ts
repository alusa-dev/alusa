import { describe, expect, it } from 'vitest';
import { invitationCreateSchema, invitationUpdateSchema } from '../../features/school-invitations/schemas';

const base = {
  schoolName: 'Escola Aurora', contactName: 'Ana Souza', email: 'ANA@ESCOLA.TEST',
  conditionType: 'STANDARD', studentCount: 45, planCode: 'BAND_026_050',
};

describe('commercial school invitation conditions', () => {
  it('normalizes email and applies the approved trial and 72-hour expiry defaults', () => {
    expect(invitationCreateSchema.parse(base)).toMatchObject({ email: 'ana@escola.test', trialDays: 14, expirationHours: 72 });
  });

  it('rejects standard self-service invitations above 500 students', () => {
    expect(invitationCreateSchema.safeParse({ ...base, studentCount: 501 }).success).toBe(false);
  });

  it('derives a standard band from student count and ignores a conflicting client band', () => {
    expect(invitationCreateSchema.parse({ ...base, studentCount: 250, planCode: 'BAND_001_025' })).toMatchObject({
      studentCount: 250, planCode: 'BAND_201_300',
    });
    expect(invitationCreateSchema.parse({ ...base, studentCount: 20, planCode: 'BAND_401_500' })).toMatchObject({
      studentCount: 20, planCode: 'BAND_001_025',
    });
  });

  it('derives the update band from the selected standard count', () => {
    expect(invitationUpdateSchema.parse({ conditionType: 'STANDARD', studentCount: 250, planCode: 'BAND_001_025' })).toMatchObject({
      conditionType: 'STANDARD', studentCount: 250, planCode: 'BAND_201_300',
    });
  });

  it('rejects standard updates above 500 students', () => {
    expect(invitationUpdateSchema.safeParse({ conditionType: 'STANDARD', studentCount: 501 }).success).toBe(false);
  });

  it('requires a base price, included students and per-student overage for custom conditions', () => {
    expect(invitationCreateSchema.safeParse({ ...base, conditionType: 'CUSTOM', planCode: undefined }).success).toBe(false);
    expect(invitationCreateSchema.safeParse({ ...base, conditionType: 'CUSTOM', planCode: undefined, customBaseMonthlyAmountCents: 95000, customIncludedStudentCount: 25, customMonthlyOverageAmountCents: 500 }).success).toBe(true);
  });

  it('accepts only the approved trial presets', () => {
    expect(invitationCreateSchema.safeParse({ ...base, trialDays: 9 }).success).toBe(false);
  });
});
