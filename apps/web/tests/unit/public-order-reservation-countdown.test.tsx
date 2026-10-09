import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicOrderReservationCountdown } from '@/features/events/map/public/PublicOrderReservationCountdown';

describe('PublicOrderReservationCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T00:00:00.000Z'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('sincroniza o pagamento uma única vez quando a reserva expira', () => {
    const onExpired = vi.fn();
    render(
      <PublicOrderReservationCountdown
        expiresAt="2026-10-07T00:00:01.000Z"
        onExpired={onExpired}
      />,
    );

    expect(screen.getByText('00:00:01')).toBeTruthy();
    expect(onExpired).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByText('Expirado')).toBeTruthy();
    expect(screen.getByText('Verificando o pagamento antes de liberar os assentos.')).toBeTruthy();
    expect(onExpired).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(5_000));

    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
