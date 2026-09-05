type ContractTemplateIdempotencyInput = {
  phoneNumberId: string;
  notificationId: string;
  attempt: number;
  contaId: string;
  contratoId: string;
  recipientPhone: string;
  templateName: string;
};

/**
 * Keeps duplicate claims idempotent while allowing an explicit requeue to
 * create a new outbound job after a previous attempt failed.
 */
export function buildContractTemplateIdempotencyKey(input: ContractTemplateIdempotencyInput): string {
  return [
    'contract-template',
    input.phoneNumberId,
    input.notificationId,
    input.attempt,
    input.contaId,
    input.contratoId,
    input.recipientPhone,
    input.templateName,
  ].join(':');
}
