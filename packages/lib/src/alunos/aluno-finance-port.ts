/**
 * Finance capabilities required by student lifecycle persistence.
 * The application layer supplies these operations so `@alusa/lib` stays
 * independent from `@alusa/finance` at runtime.
 */
export type StudentPayerProfile = {
  role: 'STUDENT' | 'RESPONSIBLE';
  id?: string;
  name: string;
  taxId: string;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  address?: string | null;
  postalCode?: string | null;
  addressNumber?: string | null;
  complement?: string | null;
  province?: string | null;
  existingCustomerReference?: string | null;
};

export type StudentFinancialLifecycleResult = {
  success: boolean;
  action: 'INACTIVATED' | 'SKIPPED' | 'ERROR';
  reason?: string;
  error?: string;
};

export type StudentFinancePort = {
  ensurePayerProfile(_params: { tenantId: string; payer: StudentPayerProfile }): Promise<void>;
  deactivatePayerProfile(_params: { studentId: string; tenantId: string }): Promise<StudentFinancialLifecycleResult>;
  synchronizeStudentProfile(_params: { studentId: string; tenantId: string }): Promise<void>;
};
