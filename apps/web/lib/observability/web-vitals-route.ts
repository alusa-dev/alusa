const WEB_VITAL_ROUTE_CATEGORIES = new Set([
  'dashboard', 'portal', 'finance', 'alunos', 'aluno', 'students', 'student',
  'matriculas', 'enrollments', 'responsaveis', 'responsibles', 'eventos',
  'events', 'aulas', 'lessons', 'login', 'register', 'help',
]);

/** Web Vitals payloads originate in the browser: retain only a known static section. */
export function normalizeWebVitalRoute(route: string): string {
  const pathname = route.split(/[?#]/, 1)[0] || '/';
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  if (!firstSegment) return '/';

  let decoded = firstSegment;
  try {
    decoded = decodeURIComponent(firstSegment);
  } catch {
    return '/other';
  }

  const normalized = decoded.toLowerCase();
  return WEB_VITAL_ROUTE_CATEGORIES.has(normalized) ? `/${normalized}` : '/other';
}
