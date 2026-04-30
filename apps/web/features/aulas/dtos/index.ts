import { z } from 'zod';

const csvArray = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return value;
  }, z.array(schema));

export const calendarEventTypeSchema = z.enum([
  'AULA',
  'REPOSICAO',
  'EVENTO_INTERNO',
  'EVENTO_EXTERNO',
  'WORKSHOP',
  'FERIADO',
  'PAUSA',
  'CANCELAMENTO',
  'SUBSTITUICAO',
]);

export const calendarEventStatusSchema = z.enum(['AGENDADO', 'CANCELADO', 'REALIZADO']);
export const attendanceStatusSchema = z.enum([
  'PRESENTE',
  'FALTA',
  'FALTA_JUSTIFICADA',
  'ATRASO',
  'REPOSICAO',
]);
export const makeupClassStatusSchema = z.enum(['AGENDADA', 'REALIZADA', 'CANCELADA']);
export const makeupClassScopeSchema = z.enum(['INDIVIDUAL', 'COLETIVA']);
export const aulasOperationLogLevelSchema = z.enum(['INFO', 'WARNING', 'ERROR']);
export const timelineGroupBySchema = z.enum(['professor', 'sala', 'turma']).default('professor');
export const agendaViewModeSchema = z
  .enum(['week', 'month-detailed', 'month-compact'])
  .default('week');

export const aulasLookupItemSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const calendarEventProfessorSchema = z.object({
  id: z.string(),
  nome: z.string(),
});

export const calendarEventConflictSchema = z.object({
  type: z.enum(['SALA', 'PROFESSOR']),
  message: z.string(),
  relatedEventId: z.string().nullable().optional(),
});

export const calendarEventAttendanceSummarySchema = z.object({
  totalEligible: z.number().int().nonnegative(),
  recorded: z.number().int().nonnegative(),
  presente: z.number().int().nonnegative(),
  falta: z.number().int().nonnegative(),
  faltaJustificada: z.number().int().nonnegative(),
  atraso: z.number().int().nonnegative(),
  reposicao: z.number().int().nonnegative(),
});

export const calendarEventListItemSchema = z.object({
  id: z.string(),
  type: calendarEventTypeSchema,
  status: calendarEventStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string(),
  source: z.string().nullable(),
  manuallyAdjusted: z.boolean(),
  turma: aulasLookupItemSchema.nullable(),
  sala: aulasLookupItemSchema.nullable(),
  professores: z.array(calendarEventProfessorSchema),
  attendanceSummary: calendarEventAttendanceSummarySchema.nullable(),
  conflicts: z.array(calendarEventConflictSchema),
});

export const calendarEventDetailsSchema = calendarEventListItemSchema.extend({
  makeupsAsOrigin: z.array(
    z.object({
      id: z.string(),
      status: makeupClassStatusSchema,
      scope: makeupClassScopeSchema,
      destinationEventId: z.string(),
    }),
  ),
  makeupsAsDestination: z.array(
    z.object({
      id: z.string(),
      status: makeupClassStatusSchema,
      scope: makeupClassScopeSchema,
      originEventId: z.string(),
    }),
  ),
});

export const listCalendarEventsQuerySchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  turmaId: z.string().optional(),
  professorId: z.string().optional(),
  salaId: z.string().optional(),
  type: csvArray(calendarEventTypeSchema).optional(),
  status: csvArray(calendarEventStatusSchema).optional(),
  viewMode: agendaViewModeSchema.optional(),
  timelineGroupBy: timelineGroupBySchema.optional(),
});

export const createCalendarEventInputSchema = z
  .object({
    title: z.string().min(2),
    description: z.string().trim().optional().nullable(),
    type: calendarEventTypeSchema,
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    turmaId: z.string().optional().nullable(),
    salaId: z.string().optional().nullable(),
    professorIds: z.array(z.string()).optional().default([]),
  })
  .refine((input) => new Date(input.endAt).getTime() > new Date(input.startAt).getTime(), {
    message: 'endAt must be after startAt',
    path: ['endAt'],
  });

export const updateCalendarEventInputSchema = z
  .object({
    title: z.string().min(2).optional(),
    description: z.string().trim().optional().nullable(),
    type: calendarEventTypeSchema.optional(),
    status: calendarEventStatusSchema.optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    turmaId: z.string().optional().nullable(),
    salaId: z.string().optional().nullable(),
    professorIds: z.array(z.string()).optional(),
  })
  .refine(
    (input) =>
      !input.startAt || !input.endAt || new Date(input.endAt).getTime() > new Date(input.startAt).getTime(),
    {
      message: 'endAt must be after startAt',
      path: ['endAt'],
    },
  );

export const listCalendarEventsResultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    range: z.object({
      start: z.string(),
      end: z.string(),
    }),
    resources: z.object({
      turmas: z.array(aulasLookupItemSchema),
      professores: z.array(aulasLookupItemSchema),
      salas: z.array(aulasLookupItemSchema),
    }),
    events: z.array(calendarEventListItemSchema),
  }),
});

export const calendarEventDetailsResultSchema = z.object({
  success: z.literal(true),
  data: calendarEventDetailsSchema,
});

export const attendanceStudentSchema = z.object({
  alunoId: z.string(),
  nome: z.string(),
  matriculaId: z.string().nullable(),
  source: z.enum(['TURMA', 'REPOSICAO']).default('TURMA'),
  makeupClassId: z.string().nullable().optional(),
  status: attendanceStatusSchema.nullable(),
  observacao: z.string().nullable(),
});

export const saveAttendanceInputSchema = z.object({
  items: z.array(
    z.object({
      alunoId: z.string(),
      matriculaId: z.string().optional().nullable(),
      status: attendanceStatusSchema,
      observacao: z.string().trim().optional().nullable(),
    }),
  ),
});

export const attendanceEventDetailsResultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    event: calendarEventDetailsSchema,
    students: z.array(attendanceStudentSchema),
    summary: calendarEventAttendanceSummarySchema,
  }),
});

export const listAttendanceQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  turmaId: z.string().optional(),
  professorId: z.string().optional(),
});

export const attendanceWorkspaceLaunchStateSchema = z.enum([
  'SEM_AULA',
  'FUTURA',
  'PENDENTE',
  'EM_ANDAMENTO',
  'REALIZADA',
  'CANCELADA',
]);

export const listAttendanceWorkspaceQuerySchema = z.object({
  date: z.string().datetime().optional(),
  search: z.string().trim().optional(),
});

export const attendanceWorkspaceOccurrenceSchema = z.object({
  eventId: z.string(),
  title: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  status: calendarEventStatusSchema,
  launchState: attendanceWorkspaceLaunchStateSchema,
  sala: aulasLookupItemSchema.nullable(),
  professores: z.array(calendarEventProfessorSchema),
  attendanceSummary: calendarEventAttendanceSummarySchema,
});

export const attendanceWorkspaceTurmaItemSchema = z.object({
  turma: aulasLookupItemSchema,
  sala: aulasLookupItemSchema.nullable(),
  professores: z.array(aulasLookupItemSchema),
  launchState: attendanceWorkspaceLaunchStateSchema,
  occurrenceCount: z.number().int().nonnegative(),
  selectedOccurrence: attendanceWorkspaceOccurrenceSchema.nullable(),
});

export const attendanceWorkspaceResultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    selectedDate: z.string(),
    professorScope: z.object({
      active: z.boolean(),
      professorId: z.string().nullable(),
      label: z.string().nullable(),
      reason: z.enum(['PROFESSOR_NOT_LINKED']).nullable().optional(),
      message: z.string().nullable().optional(),
    }),
    summary: z.object({
      totalTurmas: z.number().int().nonnegative(),
      comAula: z.number().int().nonnegative(),
      pendentes: z.number().int().nonnegative(),
      emAndamento: z.number().int().nonnegative(),
      realizadas: z.number().int().nonnegative(),
      semAula: z.number().int().nonnegative(),
    }),
    items: z.array(attendanceWorkspaceTurmaItemSchema),
  }),
});

export const attendanceTurmaWorkspaceResultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    selectedDate: z.string(),
    turma: aulasLookupItemSchema,
    sala: aulasLookupItemSchema.nullable(),
    professores: z.array(aulasLookupItemSchema),
    occurrences: z.array(attendanceWorkspaceOccurrenceSchema),
    selectedOccurrenceId: z.string().nullable(),
  }),
});

export const attendanceHistorySummarySchema = z.object({
  recorded: z.number().int().nonnegative(),
  presentes: z.number().int().nonnegative(),
  faltas: z.number().int().nonnegative(),
  justificadas: z.number().int().nonnegative(),
  atrasos: z.number().int().nonnegative(),
  reposicoes: z.number().int().nonnegative(),
});

export const attendanceHistoryTurmaItemSchema = z.object({
  turma: aulasLookupItemSchema.nullable(),
  professores: z.array(aulasLookupItemSchema),
  occurrenceCount: z.number().int().nonnegative(),
  lastLaunchedAt: z.string(),
  summary: attendanceHistorySummarySchema,
});

export const attendanceHistoryOccurrenceItemSchema = z.object({
  eventId: z.string(),
  eventTitle: z.string(),
  eventType: calendarEventTypeSchema,
  date: z.string(),
  professores: z.array(calendarEventProfessorSchema),
  summary: attendanceHistorySummarySchema,
});

export const listAttendanceResultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    resources: z.object({
      turmas: z.array(aulasLookupItemSchema),
      professores: z.array(aulasLookupItemSchema),
    }),
    summary: attendanceHistorySummarySchema.extend({
      totalTurmas: z.number().int().nonnegative(),
      totalOcorrencias: z.number().int().nonnegative(),
    }),
    items: z.array(attendanceHistoryTurmaItemSchema),
  }),
});

export const attendanceHistoryTurmaResultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    turma: aulasLookupItemSchema,
    summary: attendanceHistorySummarySchema.extend({
      totalOcorrencias: z.number().int().nonnegative(),
    }),
    items: z.array(attendanceHistoryOccurrenceItemSchema),
  }),
});

export const createMakeupClassInputSchema = z.object({
  scope: makeupClassScopeSchema,
  alunoId: z.string().optional().nullable(),
  matriculaId: z.string().optional().nullable(),
  eventoOrigemId: z.string(),
  eventoDestinoId: z.string().optional().nullable(),
  turmaOrigemId: z.string(),
  turmaDestinoId: z.string(),
  observacao: z.string().trim().optional().nullable(),
  destinationEvent: z
    .object({
      title: z.string().min(2).optional(),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      salaId: z.string().optional().nullable(),
      professorIds: z.array(z.string()).optional().default([]),
    })
    .optional(),
});

export const updateMakeupClassInputSchema = z.object({
  status: makeupClassStatusSchema.optional(),
  observacao: z.string().trim().optional().nullable(),
});

export const listMakeupClassesQuerySchema = z.object({
  turmaId: z.string().optional(),
  alunoId: z.string().optional(),
  status: csvArray(makeupClassStatusSchema).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

export const listAgendaOperationLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const agendaOperationLogSchema = z.object({
  id: z.string(),
  level: aulasOperationLogLevelSchema,
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  message: z.string(),
  details: z.unknown().nullable().optional(),
  createdAt: z.string(),
});

export const listAgendaOperationLogsResultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    items: z.array(agendaOperationLogSchema),
  }),
});

export const rebuildAgendaWindowInputSchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  reason: z.string().trim().optional(),
});

export const rebuildAgendaWindowResultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    summary: z.object({
      start: z.string(),
      end: z.string(),
      created: z.number().int().nonnegative(),
      updated: z.number().int().nonnegative(),
      cancelled: z.number().int().nonnegative(),
      deleted: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
    }),
    logs: z.array(agendaOperationLogSchema),
  }),
});

export const makeupClassItemSchema = z.object({
  id: z.string(),
  scope: makeupClassScopeSchema,
  status: makeupClassStatusSchema,
  observacao: z.string().nullable(),
  createdAt: z.string(),
  aluno: aulasLookupItemSchema.nullable(),
  turmaOrigem: aulasLookupItemSchema,
  turmaDestino: aulasLookupItemSchema,
  eventoOrigem: z.object({
    id: z.string(),
    title: z.string(),
    startAt: z.string(),
  }),
  eventoDestino: z.object({
    id: z.string(),
    title: z.string(),
    startAt: z.string(),
  }),
});

export const listMakeupClassesResultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    resources: z.object({
      turmas: z.array(aulasLookupItemSchema),
      alunos: z.array(aulasLookupItemSchema),
    }),
    items: z.array(makeupClassItemSchema),
  }),
});

export const makeupClassDetailsResultSchema = z.object({
  success: z.literal(true),
  data: makeupClassItemSchema,
});

export const aulasDashboardItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  turma: aulasLookupItemSchema.nullable(),
  sala: aulasLookupItemSchema.nullable(),
});

export const aulasDashboardResultSchema = z.object({
  success: z.literal(true),
  data: z.object({
    items: z.array(aulasDashboardItemSchema),
  }),
});

export type CalendarEventTypeDTO = z.infer<typeof calendarEventTypeSchema>;
export type CalendarEventStatusDTO = z.infer<typeof calendarEventStatusSchema>;
export type AttendanceStatusDTO = z.infer<typeof attendanceStatusSchema>;
export type MakeupClassStatusDTO = z.infer<typeof makeupClassStatusSchema>;
export type MakeupClassScopeDTO = z.infer<typeof makeupClassScopeSchema>;
export type AulasOperationLogLevelDTO = z.infer<typeof aulasOperationLogLevelSchema>;
export type AgendaViewModeDTO = z.infer<typeof agendaViewModeSchema>;
export type TimelineGroupByDTO = z.infer<typeof timelineGroupBySchema>;
export type AulasLookupItemDTO = z.infer<typeof aulasLookupItemSchema>;
export type CalendarEventProfessorDTO = z.infer<typeof calendarEventProfessorSchema>;
export type CalendarEventConflictDTO = z.infer<typeof calendarEventConflictSchema>;
export type CalendarEventAttendanceSummaryDTO = z.infer<typeof calendarEventAttendanceSummarySchema>;
export type CalendarEventListItemDTO = z.infer<typeof calendarEventListItemSchema>;
export type CalendarEventDetailsDTO = z.infer<typeof calendarEventDetailsSchema>;
export type ListCalendarEventsQueryDTO = z.infer<typeof listCalendarEventsQuerySchema>;
export type CreateCalendarEventInputDTO = z.infer<typeof createCalendarEventInputSchema>;
export type UpdateCalendarEventInputDTO = z.infer<typeof updateCalendarEventInputSchema>;
export type ListCalendarEventsResultDTO = z.infer<typeof listCalendarEventsResultSchema>;
export type CalendarEventDetailsResultDTO = z.infer<typeof calendarEventDetailsResultSchema>;
export type AttendanceStudentDTO = z.infer<typeof attendanceStudentSchema>;
export type SaveAttendanceInputDTO = z.infer<typeof saveAttendanceInputSchema>;
export type AttendanceEventDetailsResultDTO = z.infer<typeof attendanceEventDetailsResultSchema>;
export type ListAttendanceQueryDTO = z.infer<typeof listAttendanceQuerySchema>;
export type ListAttendanceWorkspaceQueryDTO = z.infer<typeof listAttendanceWorkspaceQuerySchema>;
export type AttendanceWorkspaceLaunchStateDTO = z.infer<typeof attendanceWorkspaceLaunchStateSchema>;
export type AttendanceWorkspaceOccurrenceDTO = z.infer<typeof attendanceWorkspaceOccurrenceSchema>;
export type AttendanceWorkspaceTurmaItemDTO = z.infer<typeof attendanceWorkspaceTurmaItemSchema>;
export type AttendanceWorkspaceResultDTO = z.infer<typeof attendanceWorkspaceResultSchema>;
export type AttendanceTurmaWorkspaceResultDTO = z.infer<typeof attendanceTurmaWorkspaceResultSchema>;
export type AttendanceHistorySummaryDTO = z.infer<typeof attendanceHistorySummarySchema>;
export type AttendanceHistoryTurmaItemDTO = z.infer<typeof attendanceHistoryTurmaItemSchema>;
export type AttendanceHistoryOccurrenceItemDTO = z.infer<typeof attendanceHistoryOccurrenceItemSchema>;
export type ListAttendanceResultDTO = z.infer<typeof listAttendanceResultSchema>;
export type AttendanceHistoryTurmaResultDTO = z.infer<typeof attendanceHistoryTurmaResultSchema>;
export type CreateMakeupClassInputDTO = z.infer<typeof createMakeupClassInputSchema>;
export type UpdateMakeupClassInputDTO = z.infer<typeof updateMakeupClassInputSchema>;
export type ListMakeupClassesQueryDTO = z.infer<typeof listMakeupClassesQuerySchema>;
export type MakeupClassItemDTO = z.infer<typeof makeupClassItemSchema>;
export type ListMakeupClassesResultDTO = z.infer<typeof listMakeupClassesResultSchema>;
export type MakeupClassDetailsResultDTO = z.infer<typeof makeupClassDetailsResultSchema>;
export type AulasDashboardResultDTO = z.infer<typeof aulasDashboardResultSchema>;
export type AulasDashboardItemDTO = z.infer<typeof aulasDashboardItemSchema>;
export type AgendaOperationLogDTO = z.infer<typeof agendaOperationLogSchema>;
export type ListAgendaOperationLogsQueryDTO = z.infer<typeof listAgendaOperationLogsQuerySchema>;
export type ListAgendaOperationLogsResultDTO = z.infer<typeof listAgendaOperationLogsResultSchema>;
export type RebuildAgendaWindowInputDTO = z.infer<typeof rebuildAgendaWindowInputSchema>;
export type RebuildAgendaWindowResultDTO = z.infer<typeof rebuildAgendaWindowResultSchema>;
