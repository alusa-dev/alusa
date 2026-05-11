import {
  dashboardFinanceKpisResultDTOSchema,
  dashboardMetricsResultDTOSchema,
  dashboardSerieResultDTOSchema,
} from './dtos';

export function mapDashboardMetricsResultToDTO(record: Record<string, unknown>) {
  return dashboardMetricsResultDTOSchema.parse(record);
}

export function mapDashboardFinanceKpisResultToDTO(record: Record<string, unknown>) {
  return dashboardFinanceKpisResultDTOSchema.parse(record);
}

export function mapDashboardSerieResultToDTO(record: Record<string, unknown>) {
  return dashboardSerieResultDTOSchema.parse(record);
}
