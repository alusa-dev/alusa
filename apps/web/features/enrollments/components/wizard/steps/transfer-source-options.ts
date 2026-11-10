export interface EffectiveSourceLink {
  id: string;
  modalidade: { id: string; nome: string };
  cicloAcademico: { id: string; nome: string } | null;
  transferenciaOrigem: { id: string } | null;
}

export function getEligibleTransferSources(
  sourceLinks: EffectiveSourceLink[],
  destinationModalidadeId?: string,
): EffectiveSourceLink[] {
  if (!destinationModalidadeId) return [];
  return sourceLinks.filter(
    (link) => link.modalidade.id !== destinationModalidadeId && link.transferenciaOrigem == null,
  );
}
