import { validateContractSigner } from '@alusa/domain';

type SignerPerson = {
  cpf: string | null | undefined;
  nome: string | null | undefined;
  dataNasc?: Date | string | null;
  email?: string | null;
};

export function resolvePublicContractSigner(input: {
  cpf: string;
  now?: Date;
  aluno: SignerPerson;
  responsavelFinanceiro?: SignerPerson | null;
  responsaveis?: Array<SignerPerson & { contaId?: string }>;
  contaId?: string;
}) {
  const signer = validateContractSigner({
    cpf: input.cpf,
    now: input.now,
    aluno: input.aluno,
    responsavelFinanceiro: input.responsavelFinanceiro,
    responsaveis: (input.responsaveis ?? [])
      .filter((person) => !input.contaId || person.contaId === input.contaId)
      .map(({ cpf, nome, dataNasc }) => ({ cpf, nome, dataNasc })),
  });

  if (!signer.ok) throw new Error(signer.code);

  const normalizedCpf = input.cpf.replace(/\D/g, '');
  const studentCpf = input.aluno.cpf?.replace(/\D/g, '') ?? null;
  const financialCpf = input.responsavelFinanceiro?.cpf?.replace(/\D/g, '') ?? null;
  const linkedResponsible = (input.responsaveis ?? []).find((person) => {
    if (input.contaId && person.contaId !== input.contaId) return false;
    return person.cpf?.replace(/\D/g, '') === normalizedCpf;
  });

  const email = normalizedCpf === studentCpf
    ? input.aluno.email
    : normalizedCpf === financialCpf
      ? input.responsavelFinanceiro?.email
      : linkedResponsible?.email;

  if (!email?.trim()) throw new Error('SIGNATURE_OTP_EMAIL_MISSING');

  return {
    signer: signer.signer,
    email: email.trim().toLowerCase(),
  };
}
