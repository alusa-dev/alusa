export type EventPayerCandidate = {
  responsibleName?: string | null;
  studentName?: string | null;
  displayName?: string | null;
};

function uniqueNames(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

/**
 * Em cobranças de evento, o responsável é o pagador financeiro. O aluno e o
 * displayName continuam como fallback para registros legados incompletos.
 */
export function resolveEventPayerName(candidates: readonly EventPayerCandidate[]): string | null {
  const responsibleNames = uniqueNames(candidates.map((candidate) => candidate.responsibleName));
  if (responsibleNames.length > 0) return responsibleNames.join(', ');

  const fallbackNames = uniqueNames(
    candidates.flatMap((candidate) => [candidate.studentName, candidate.displayName]),
  );
  return fallbackNames.join(', ') || null;
}
