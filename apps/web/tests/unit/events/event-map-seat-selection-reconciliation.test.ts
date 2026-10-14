import { afterEach, describe, expect, it, vi } from 'vitest';

import { reconcilePublicMapSeatSelection } from '../../../features/events/map/public/PublicMapExperience';
import { isSeatSelectable, reconcileStaffMapSeatSelection, toggleStaffSeatSelection } from '../../../features/events/tickets/StaffSeatPickerDialog';
import { reserveStaffSeats } from '../../../features/events/events-service';

describe('event map seat selection reconciliation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('removes only public selections that are no longer available', () => {
    const result = reconcilePublicMapSeatSelection(
      [{ id: 'a', status: 'SOLD' }, { id: 'b', status: 'AVAILABLE' }, { id: 'c', status: 'HELD' }],
      ['b', 'c'],
    );

    expect(result.selectedIds).toEqual(['b']);
    expect(result.removedUnavailable).toBe(true);
  });

  it('treats server availability as authoritative after a hold expires', () => {
    const result = reconcileStaffMapSeatSelection(
      [{ id: 'expired', status: 'AVAILABLE', isOwnHold: false }, { id: 'sold', status: 'SOLD', isOwnHold: false }],
      [{ id: 'expired', status: 'HELD', isOwnHold: true }, { id: 'sold', status: 'HELD', isOwnHold: true }],
      ['expired', 'sold'],
      new Set(['expired', 'sold']),
    );

    expect(result.seats.map((seat) => seat.status)).toEqual(['AVAILABLE', 'SOLD']);
    expect(result.selectedIds).toEqual(['expired']);
    expect(result.removedUnavailable).toBe(true);
    expect(result.expiredOwnHold).toBe(true);
    expect(isSeatSelectable(result.seats[0]!, result.selectedIds, new Set())).toBe(true);
    expect(isSeatSelectable(result.seats[1]!, result.selectedIds, new Set())).toBe(false);
    expect(toggleStaffSeatSelection(result.seats[0]!, result.selectedIds, new Set())).toEqual([]);
  });

  it('does not treat another staff user’s replacement hold as the current hold', () => {
    const result = reconcileStaffMapSeatSelection(
      [{ id: 'seat', status: 'HELD', isOwnHold: false }],
      [{ id: 'seat', status: 'HELD', isOwnHold: true }],
      ['seat'],
      new Set(['seat']),
    );

    expect(result.selectedIds).toEqual([]);
    expect(result.expiredOwnHold).toBe(true);
    expect(isSeatSelectable(result.seats[0]!, [], new Set(['seat']))).toBe(false);
  });

  it('creates a fresh hold without sending an expired hold token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { holdToken: 'new-hold' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await reserveStaffSeats('event-1', 'map-1', { seatIds: ['expired'] });

    expect(fetchMock).toHaveBeenCalledWith('/api/events/event-1/maps/map-1/staff-reservations', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ seatIds: ['expired'], holdToken: null }),
    }));
  });
});
