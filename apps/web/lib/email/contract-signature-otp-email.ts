import { sendTransactionalEmail } from './transactional-email';

const CONTRACT_SIGNATURE_OTP_TEMPLATE_ID =
  process.env.RESEND_CONTRACT_SIGNATURE_OTP_TEMPLATE_ID
  || '83d3da1e-5480-46ff-a79f-4f0f14dc1e5a';

export async function sendContractSignatureOtpEmail(input: {
  to: string;
  recipientName: string;
  code: string;
  expiresIn: string;
  schoolName: string;
  contractReference: string;
  idempotencyKey: string;
}) {
  return sendTransactionalEmail({
    to: input.to,
    category: 'contract_signature_otp',
    idempotencyKey: input.idempotencyKey,
    from: process.env.EMAIL_FROM_CONTRACTS
      || process.env.EMAIL_FROM_AUTH
      || process.env.EMAIL_FROM_INVITES,
    subject: 'Seu código para assinar o contrato na Alusa',
    template: {
      id: CONTRACT_SIGNATURE_OTP_TEMPLATE_ID,
      variables: {
        RECIPIENT_NAME: input.recipientName,
        OTP_CODE: input.code,
        EXPIRES_IN: input.expiresIn,
        SCHOOL_NAME: input.schoolName,
        CONTRACT_REFERENCE: input.contractReference,
      },
    },
    tags: [
      { name: 'category', value: 'contract_signature_otp' },
      { name: 'contract_reference', value: input.contractReference },
    ],
  });
}
