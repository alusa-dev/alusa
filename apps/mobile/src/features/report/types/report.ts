export type ReportPeriod = 'this-month' | 'previous-month' | 'last-3-months';

export type ReportMetricSummary = {
  totalCharges: number;
  received: number;
  receivable: number;
  overdue: number;
  fees: number;
  refunds: number;
  net: number;
  averageTicket: number;
  delinquencyRate: number;
  chargeCount: number;
  receivedCount: number;
  overdueCount: number;
};

export type ReportEnrollmentHealth = {
  activeEnrollments: number;
  enrollmentsInPeriod: number;
  cancellationsInPeriod: number;
  retentionRate: number | null;
};

export type ReportSeriesItem = {
  key: string;
  label: string;
  charged: number;
  received: number;
  overdue: number;
  net: number;
};

export type ReportOccupancyItem = {
  id: string;
  name: string;
  capacity: number;
  occupiedSeats: number;
  occupancyRate: number;
};

export type ReportHighlight = {
  title: string;
  value: string;
  description: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
};

export type ReportHealth = {
  level: 'healthy' | 'stable' | 'attention' | 'critical' | 'empty';
  label: string;
  description: string;
  score: number | null;
  coverage: number;
};

export type ReportDataQuality = {
  excludedRecords: number;
  warnings: string[];
};

export type ReportResponse = {
  period: ReportPeriod;
  periodLabel: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  timeZone: string;
  summary: ReportMetricSummary;
  enrollmentHealth: ReportEnrollmentHealth;
  series: ReportSeriesItem[];
  health: ReportHealth;
  highlights: ReportHighlight[];
  classOccupancy: ReportOccupancyItem[];
  dataQuality: ReportDataQuality;
};
