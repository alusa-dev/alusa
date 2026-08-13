type SignatureFieldLike = {
  papel: string;
  obrigatorio: boolean;
};

export function hasRequiredContractSignatureFields(
  fields: readonly SignatureFieldLike[] | null | undefined,
): boolean {
  if (!fields?.length) return false;

  return (
    fields.some((field) => field.papel === 'ESCOLA' && field.obrigatorio) &&
    fields.some((field) => field.papel === 'RESPONSAVEL_OU_ALUNO' && field.obrigatorio)
  );
}

export function getMissingContractSignatureFieldsMessage(
  fields: readonly SignatureFieldLike[] | null | undefined,
): string {
  if (!fields?.some((field) => field.papel === 'ESCOLA' && field.obrigatorio)) {
    return 'O modelo precisa ter um campo obrigatório de assinatura da escola.';
  }

  if (!fields.some((field) => field.papel === 'RESPONSAVEL_OU_ALUNO' && field.obrigatorio)) {
    return 'O modelo precisa ter um campo obrigatório de assinatura do responsável/aluno.';
  }

  return 'O modelo precisa ter os campos obrigatórios de assinatura configurados.';
}
