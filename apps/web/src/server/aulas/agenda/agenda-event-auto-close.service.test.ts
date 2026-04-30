import { describe, expect, it } from 'vitest';

import {
  AGENDA_EVENT_AUTO_CLOSE_POLICY,
  AGENDA_EVENT_AUTO_CLOSE_TOLERANCE_BUSINESS_DAYS,
  evaluateAgendaEventAutoClose,
  getAgendaEventAutoCloseDeadline,
} from './agenda-event-auto-close.service';

describe('agenda-event-auto-close.service', () => {
  it('calcula o prazo de auto-fechamento em 3 dias úteis', () => {
    const deadline = getAgendaEventAutoCloseDeadline(new Date('2026-03-13T14:00:00.000Z'));

    expect(AGENDA_EVENT_AUTO_CLOSE_TOLERANCE_BUSINESS_DAYS).toBe(3);
    expect(AGENDA_EVENT_AUTO_CLOSE_POLICY.toleranceBusinessDays).toBe(3);
    expect(AGENDA_EVENT_AUTO_CLOSE_POLICY.attendanceRequiredEventTypes).toEqual([
      'AULA',
      'REPOSICAO',
    ]);
    expect(deadline.toISOString()).toBe('2026-03-19T03:59:59.999Z');
  });

  it('mantém o evento no período de tolerância antes do prazo', () => {
    const decision = evaluateAgendaEventAutoClose({
      status: 'AGENDADO',
      type: 'EVENTO_INTERNO',
      endAt: new Date('2026-03-16T18:00:00.000Z'),
      eligibleStudents: 0,
      recordedAttendance: 0,
      referenceDate: new Date('2026-03-18T10:00:00.000Z'),
    });

    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe('GRACE_PERIOD_ACTIVE');
  });

  it('bloqueia auto-fechamento de aula com alunos elegíveis e sem frequência', () => {
    const decision = evaluateAgendaEventAutoClose({
      status: 'AGENDADO',
      type: 'AULA',
      endAt: new Date('2026-03-10T19:00:00.000Z'),
      eligibleStudents: 8,
      recordedAttendance: 0,
      referenceDate: new Date('2026-03-16T12:00:00.000Z'),
    });

    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe('ATTENDANCE_PENDING');
  });

  it('libera auto-fechamento após o prazo quando não há bloqueios operacionais', () => {
    const decision = evaluateAgendaEventAutoClose({
      status: 'AGENDADO',
      type: 'EVENTO_INTERNO',
      endAt: new Date('2026-03-10T19:00:00.000Z'),
      eligibleStudents: 0,
      recordedAttendance: 0,
      referenceDate: new Date('2026-03-16T12:00:00.000Z'),
    });

    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBe('ELIGIBLE');
  });
});
