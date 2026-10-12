import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CalendarEventDialog } from '@/features/lessons/agenda/components/CalendarEventDialog';

describe('CalendarEventDialog', () => {
  it('prefills a selected time range in the account timezone', async () => {
    render(
      <CalendarEventDialog
        open
        mode="create"
        resources={{ turmas: [], professores: [], salas: [] }}
        accountTimeZone="America/Manaus"
        initialRange={{
          startAt: '2026-08-05T14:30:00.000Z',
          endAt: '2026-08-05T15:00:00.000Z',
        }}
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('agenda-event-start')).toHaveValue('2026-08-05T10:30');
      expect(screen.getByTestId('agenda-event-end')).toHaveValue('2026-08-05T11:00');
    });
  });
});
