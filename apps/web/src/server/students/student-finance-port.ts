import {
  AsaasCustomerEnsureError,
  ensureAsaasCustomerForPayer,
  syncAlunoInativacaoToAsaas,
  syncAlunoToAsaasProvider,
} from '@alusa/finance';
import type { StudentFinancePort } from '@alusa/lib/alunos/aluno-finance-port';

/** Composes student persistence with finance use cases at the application boundary. */
export const studentFinancePort: StudentFinancePort = {
  async ensurePayerProfile({ tenantId, payer }) {
    const result = await ensureAsaasCustomerForPayer({
      contaId: tenantId,
      payer: {
        type: payer.role === 'STUDENT' ? 'ALUNO' : 'RESPONSAVEL',
        id: payer.id,
        name: payer.name,
        cpfCnpj: payer.taxId,
        email: payer.email,
        phone: payer.phone,
        mobilePhone: payer.mobilePhone,
        address: payer.address,
        postalCode: payer.postalCode,
        addressNumber: payer.addressNumber,
        complement: payer.complement,
        province: payer.province,
        asaasCustomerId: payer.existingCustomerReference,
      },
      notificationSyncMode: 'deferred',
    });
    if (!result.ok) {
      throw new AsaasCustomerEnsureError(result.error, result.message, result.status);
    }
  },
  deactivatePayerProfile({ studentId, tenantId }) {
    return syncAlunoInativacaoToAsaas({ alunoId: studentId, contaId: tenantId });
  },
  synchronizeStudentProfile({ studentId, tenantId }) {
    return syncAlunoToAsaasProvider({ alunoId: studentId, contaId: tenantId });
  },
};
