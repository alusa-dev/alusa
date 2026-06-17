import type { EventScopedPerson } from '../events-service';

export function mergeScopedPersonOptions(
  scoped: EventScopedPerson[],
  current?: { id: string; nome: string } | null,
): Array<{ value: string; label: string }> {
  const map = new Map<string, string>();
  for (const person of scoped) {
    map.set(person.id, person.nome);
  }
  if (current?.id && !map.has(current.id)) {
    map.set(current.id, current.nome);
  }
  return [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}
