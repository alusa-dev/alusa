export type FiscalInvoiceClientType = 'ALUNO' | 'RESPONSAVEL';

export type FiscalInvoiceClientRef = {
  tipo: FiscalInvoiceClientType;
  id: string;
};

export function buildFiscalInvoiceClientKey(client: FiscalInvoiceClientRef): string {
  return `${client.tipo}:${client.id}`;
}

export function resolveFiscalInvoiceClient(input: {
  responsavelId: string | null;
  matriculaAlunoId: string | null;
  customerPayerType: FiscalInvoiceClientType | null;
  customerPayerId: string | null;
}): FiscalInvoiceClientRef | null {
  if (input.responsavelId) {
    return { tipo: 'RESPONSAVEL', id: input.responsavelId };
  }

  if (input.matriculaAlunoId) {
    return { tipo: 'ALUNO', id: input.matriculaAlunoId };
  }

  if (input.customerPayerType && input.customerPayerId) {
    return { tipo: input.customerPayerType, id: input.customerPayerId };
  }

  return null;
}
