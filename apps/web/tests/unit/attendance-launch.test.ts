/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import {
  ATTENDANCE_LAUNCH_WINDOW_DAYS,
  canLaunchAttendanceForEvent,
  evaluateAttendanceLaunchPolicy,
  getAttendanceLaunchDeadline,
  getAttendanceLaunchPolicyMessage,
  isAttendanceEventOnSelectedDay,
} from '@/features/aulas/utils/attendance-launch';

describe('attendance-launch', () => {
  it('expõe a janela operacional padrão de 7 dias', () => {
    expect(ATTENDANCE_LAUNCH_WINDOW_DAYS).toBe(7);
    expect(getAttendanceLaunchDeadline('2026-03-16T23:00:00.000Z').toISOString()).toBe(
      '2026-03-24T03:59:59.999Z',
    );
  });

  it('permite lançar frequência em qualquer horário do dia da aula', () => {
    const result = canLaunchAttendanceForEvent({
      startAt: '2026-03-16T23:00:00.000Z',
      status: 'AGENDADO',
      referenceDate: new Date('2026-03-16T09:00:00.000Z'),
    });

    expect(result).toBe(true);
  });

  it('bloqueia lançamento para dia futuro', () => {
    const result = canLaunchAttendanceForEvent({
      startAt: '2026-03-17T10:00:00.000Z',
      status: 'AGENDADO',
      referenceDate: new Date('2026-03-16T22:00:00.000Z'),
    });

    expect(result).toBe(false);
  });

  it('bloqueia lançamento quando a janela operacional expirou', () => {
    const result = evaluateAttendanceLaunchPolicy({
      startAt: '2026-03-16T10:00:00.000Z',
      status: 'AGENDADO',
      referenceDate: new Date('2026-03-25T12:00:00.000Z'),
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('WINDOW_EXPIRED');
    expect(getAttendanceLaunchPolicyMessage(result.reason)).toBe(
      'A janela operacional para lançar ou corrigir a frequência expirou.',
    );
  });

  it('bloqueia lançamento para evento cancelado', () => {
    const result = evaluateAttendanceLaunchPolicy({
      startAt: '2026-03-16T10:00:00.000Z',
      status: 'CANCELADO',
      referenceDate: new Date('2026-03-16T12:00:00.000Z'),
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('EVENT_CANCELLED');
    expect(getAttendanceLaunchPolicyMessage(result.reason)).toBe(
      'Eventos cancelados não permitem lançamento de frequência.',
    );
  });

  it('identifica quando a ocorrência pertence ao dia operacional atual', () => {
    const result = isAttendanceEventOnSelectedDay({
      startAt: '2026-03-16T23:30:00.000Z',
      referenceDate: new Date('2026-03-16T08:00:00.000Z'),
    });

    expect(result).toBe(true);
  });
});
