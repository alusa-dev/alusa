import {
  attendanceHistoryTurmaResultSchema,
  attendanceEventDetailsResultSchema,
  attendanceTurmaWorkspaceResultSchema,
  attendanceWorkspaceResultSchema,
  aulasDashboardResultSchema,
  calendarEventDetailsResultSchema,
  listAgendaOperationLogsResultSchema,
  listAttendanceResultSchema,
  listCalendarEventsResultSchema,
  listMakeupClassesResultSchema,
  makeupClassDetailsResultSchema,
  rebuildAgendaWindowResultSchema,
} from './dtos';

export function mapListCalendarEventsResult(record: Record<string, unknown>) {
  return listCalendarEventsResultSchema.parse(record);
}

export function mapCalendarEventDetailsResult(record: Record<string, unknown>) {
  return calendarEventDetailsResultSchema.parse(record);
}

export function mapAttendanceEventDetailsResult(record: Record<string, unknown>) {
  return attendanceEventDetailsResultSchema.parse(record);
}

export function mapListAttendanceResult(record: Record<string, unknown>) {
  return listAttendanceResultSchema.parse(record);
}

export function mapAttendanceHistoryTurmaResult(record: Record<string, unknown>) {
  return attendanceHistoryTurmaResultSchema.parse(record);
}

export function mapAttendanceWorkspaceResult(record: Record<string, unknown>) {
  return attendanceWorkspaceResultSchema.parse(record);
}

export function mapAttendanceTurmaWorkspaceResult(record: Record<string, unknown>) {
  return attendanceTurmaWorkspaceResultSchema.parse(record);
}

export function mapListMakeupClassesResult(record: Record<string, unknown>) {
  return listMakeupClassesResultSchema.parse(record);
}

export function mapMakeupClassDetailsResult(record: Record<string, unknown>) {
  return makeupClassDetailsResultSchema.parse(record);
}

export function mapAulasDashboardResult(record: Record<string, unknown>) {
  return aulasDashboardResultSchema.parse(record);
}

export function mapListAgendaOperationLogsResult(record: Record<string, unknown>) {
  return listAgendaOperationLogsResultSchema.parse(record);
}

export function mapRebuildAgendaWindowResult(record: Record<string, unknown>) {
  return rebuildAgendaWindowResultSchema.parse(record);
}
