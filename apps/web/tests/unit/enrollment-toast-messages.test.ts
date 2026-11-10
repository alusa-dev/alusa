import { describe, expect, it } from 'vitest';
import { getEnrollmentCancellationSuccessMessage } from '@/features/enrollments/enrollment-toast-messages';

describe('getEnrollmentCancellationSuccessMessage', () => {
  it('explains briefly that overdue charges stay pending', () => {
    expect(getEnrollmentCancellationSuccessMessage([
      'A mensalidade está vencida e permanece em aberto para preservar o valor devido.',
    ])).toBe('Débitos vencidos continuam pendentes. Esta matrícula não gerará novas cobranças.');
  });

  it('keeps the success message short when there are no overdue charges', () => {
    expect(getEnrollmentCancellationSuccessMessage([])).toBe('Esta matrícula não gerará novas cobranças.');
  });
});
