export type FinancialResponsibleLink = {
  responsavelId: string;
  tipoVinculo: string;
  financeiro: boolean;
};

/** Picks the same eligible payer link everywhere a student resolves to a responsible. */
export function selectFinancialResponsible<T extends FinancialResponsibleLink>(links: T[]): T | null {
  const eligible = links.filter((link) => link.financeiro || link.tipoVinculo === 'FINANCEIRO' || link.tipoVinculo === 'PRINCIPAL');
  const priority = (link: FinancialResponsibleLink) =>
    link.tipoVinculo === 'FINANCEIRO' ? 0 : link.financeiro ? 1 : link.tipoVinculo === 'PRINCIPAL' ? 2 : 3;
  return [...eligible].sort((a, b) => priority(a) - priority(b) || a.responsavelId.localeCompare(b.responsavelId))[0] ?? null;
}
