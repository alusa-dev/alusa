import type {
  AgendaViewModeDTO,
  AttendanceStatusDTO,
  CalendarEventStatusDTO,
  CalendarEventTypeDTO,
  MakeupClassScopeDTO,
  MakeupClassStatusDTO,
  TimelineGroupByDTO,
} from '../dtos';

export const AGENDA_VIEW_OPTIONS: Array<{ value: AgendaViewModeDTO; label: string }> = [
  { value: 'week', label: 'Semana' },
  { value: 'month-detailed', label: 'Mês detalhado' },
];

export const TIMELINE_GROUP_OPTIONS: Array<{ value: TimelineGroupByDTO; label: string }> = [
  { value: 'professor', label: 'Professor' },
  { value: 'sala', label: 'Sala' },
  { value: 'turma', label: 'Turma' },
];

export const CALENDAR_EVENT_TYPE_OPTIONS: Array<{ value: CalendarEventTypeDTO; label: string }> = [
  { value: 'AULA', label: 'Aula' },
  { value: 'REPOSICAO', label: 'Reposição' },
  { value: 'EVENTO_INTERNO', label: 'Evento interno' },
  { value: 'EVENTO_EXTERNO', label: 'Evento externo' },
  { value: 'WORKSHOP', label: 'Workshop' },
  { value: 'FERIADO', label: 'Feriado' },
  { value: 'PAUSA', label: 'Pausa' },
  { value: 'CANCELAMENTO', label: 'Cancelamento' },
  { value: 'SUBSTITUICAO', label: 'Substituição' },
];

export const CALENDAR_EVENT_STATUS_OPTIONS: Array<{
  value: CalendarEventStatusDTO;
  label: string;
}> = [
  { value: 'AGENDADO', label: 'Agendado' },
  { value: 'CANCELADO', label: 'Cancelado' },
  { value: 'REALIZADO', label: 'Realizado' },
];

export const ATTENDANCE_STATUS_OPTIONS: Array<{ value: AttendanceStatusDTO; label: string }> = [
  { value: 'PRESENTE', label: 'Presente' },
  { value: 'FALTA', label: 'Falta' },
  { value: 'FALTA_JUSTIFICADA', label: 'Falta justificada' },
  { value: 'ATRASO', label: 'Atraso' },
  { value: 'REPOSICAO', label: 'Reposição' },
];

export const MAKEUP_SCOPE_OPTIONS: Array<{ value: MakeupClassScopeDTO; label: string }> = [
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'COLETIVA', label: 'Coletiva' },
];

export const MAKEUP_STATUS_OPTIONS: Array<{ value: MakeupClassStatusDTO; label: string }> = [
  { value: 'AGENDADA', label: 'Agendada' },
  { value: 'REALIZADA', label: 'Realizada' },
  { value: 'CANCELADA', label: 'Cancelada' },
];
