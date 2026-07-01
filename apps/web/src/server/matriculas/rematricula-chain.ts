export type EnrollmentChainRow = {
  id: string;
  alunoId: string;
  rematriculadaDeId: string | null;
  status: string;
  dataInicio: Date;
  dataFimContrato: Date;
  createdAt: Date;
};

export function compareEnrollmentRecency(a: EnrollmentChainRow, b: EnrollmentChainRow) {
  const startDiff = a.dataInicio.getTime() - b.dataInicio.getTime();
  if (startDiff !== 0) return startDiff;

  const endDiff = a.dataFimContrato.getTime() - b.dataFimContrato.getTime();
  if (endDiff !== 0) return endDiff;

  return a.createdAt.getTime() - b.createdAt.getTime();
}

export function resolveEnrollmentRootId(id: string, byId: Map<string, EnrollmentChainRow>) {
  let currentId = id;
  const visited = new Set<string>();

  while (!visited.has(currentId)) {
    visited.add(currentId);
    const current = byId.get(currentId);
    if (!current?.rematriculadaDeId || !byId.has(current.rematriculadaDeId)) return currentId;
    currentId = current.rematriculadaDeId;
  }

  return currentId;
}

export function isClosedEnrollmentStatus(status: string) {
  return status === 'CANCELADA' || status === 'RECUSADA';
}
