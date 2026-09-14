export type AgendaViewMode = 'week' | 'month-detailed';

export type CalendarEventType =
  | 'AULA'
  | 'AULA_EXPERIMENTAL'
  | 'REPOSICAO'
  | 'EVENTO_INTERNO'
  | 'EVENTO_EXTERNO'
  | 'WORKSHOP'
  | 'FERIADO'
  | 'PAUSA'
  | 'CANCELAMENTO'
  | 'SUBSTITUICAO';

export type CalendarEventStatus = 'AGENDADO' | 'CANCELADO' | 'REALIZADO';

export type AgendaLookup = { id: string; label: string };

export type AgendaTurmaLookup = AgendaLookup & {
  defaultSchedule?: {
    daysOfWeek: string[];
    startTime: string;
    endTime: string;
    salaId: string | null;
    professorIds: string[];
  };
};

export type CalendarEvent = {
  id: string;
  type: CalendarEventType;
  status: CalendarEventStatus;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  source: string | null;
  manuallyAdjusted: boolean;
  turma: AgendaLookup | null;
  sala: AgendaLookup | null;
  professores: Array<{ id: string; nome: string }>;
  attendanceSummary: {
    totalEligible: number;
    recorded: number;
    presente: number;
    falta: number;
    faltaJustificada: number;
    atraso: number;
    reposicao: number;
  } | null;
  conflicts: Array<{
    type: 'SALA' | 'PROFESSOR';
    message: string;
    relatedEventId?: string | null;
  }>;
};

export type CalendarEventDetails = CalendarEvent & {
  experimental?: {
    id: string;
    status: 'AGENDADA' | 'REAGENDADA' | 'REALIZADA' | 'CANCELADA';
    observacao: string | null;
    aluno: AgendaLookup;
  } | null;
  makeupsAsOrigin: Array<{
    id: string;
    status: 'AGENDADA' | 'REALIZADA' | 'CANCELADA';
    scope: 'INDIVIDUAL' | 'COLETIVA';
    destinationEventId: string;
  }>;
  makeupsAsDestination: Array<{
    id: string;
    status: 'AGENDADA' | 'REALIZADA' | 'CANCELADA';
    scope: 'INDIVIDUAL' | 'COLETIVA';
    originEventId: string;
  }>;
};

export type AgendaResources = {
  turmas: AgendaTurmaLookup[];
  professores: AgendaLookup[];
  salas: AgendaLookup[];
};

export type AgendaListResponse = {
  success: true;
  data: {
    range: { start: string; end: string };
    timeZone: string;
    resources?: AgendaResources;
    events: CalendarEvent[];
  };
};

export type AgendaEventResponse = {
  success: true;
  data: CalendarEventDetails;
  timeZone: string;
};

export type AttendanceStudent = {
  alunoId: string;
  nome: string;
  matriculaId: string | null;
  source: 'TURMA' | 'REPOSICAO';
  makeupClassId?: string | null;
  status: AttendanceStatus | null;
  observacao: string | null;
};

export type AttendanceStatus = 'PRESENTE' | 'FALTA' | 'FALTA_JUSTIFICADA' | 'ATRASO' | 'REPOSICAO';

export type AttendanceResponse = {
  success: true;
  data: {
    event: CalendarEventDetails;
    students: AttendanceStudent[];
    summary: {
      totalEligible: number;
      recorded: number;
      presente: number;
      falta: number;
      faltaJustificada: number;
      atraso: number;
      reposicao: number;
    };
  };
  timeZone: string;
};

export type AgendaFilters = {
  turmaId?: string;
  professorId?: string;
  salaId?: string;
  type?: CalendarEventType;
};

export type CreateAgendaEventInput = {
  title: string;
  description?: string | null;
  type: CalendarEventType;
  startAt: string;
  endAt: string;
  turmaId?: string | null;
  salaId?: string | null;
  professorIds?: string[];
};

export type UpdateAgendaEventInput = Partial<CreateAgendaEventInput> & {
  status?: CalendarEventStatus;
};
