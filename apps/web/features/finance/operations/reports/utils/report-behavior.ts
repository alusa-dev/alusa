import type { FinancialReportQuery } from '../dtos';

export function nextReportSortDirection(
  currentSort: FinancialReportQuery['sort'],
  currentDirection: 'asc' | 'desc',
  selectedSort: FinancialReportQuery['sort'],
): 'asc' | 'desc' {
  if (selectedSort !== currentSort) return 'desc';
  return currentDirection === 'desc' ? 'asc' : 'desc';
}
