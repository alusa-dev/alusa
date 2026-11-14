import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TicketSaleDTO } from '@/features/events/events-service';
import { TicketActions } from '@/features/events/tickets/TicketActions';

(globalThis as typeof globalThis & { React: typeof React }).React = React;
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const testData = vi.hoisted(() => ({
  publicOrder: {
    id: 'order-1', buyerName: 'Ana Costa', buyerEmail: 'ana@example.test', buyerPhone: '11999998888',
    totalAmount: 50, status: 'CONFIRMED', ticketFulfillmentStatus: 'ISSUED', paymentMethod: 'PIX',
    paymentStatus: 'PAID', asaasPaymentId: 'pay-1', invoiceUrl: null, createdAt: '2026-11-13T12:00:00.000Z',
    expiresAt: null, confirmedAt: '2026-11-13T12:04:00.000Z', paidAt: '2026-11-13T12:05:00.000Z',
    refundedAt: null, cancelledAt: null, map: { id: 'map-1', name: 'Mapa Principal', publicSlug: 'principal' },
    lotNames: ['Lote Família'], seats: [
      { sectionName: 'Setor 1', seatLabel: 'A3' },
      { sectionName: 'Setor 1', seatLabel: 'A4' },
    ], seatCount: 2, ticketCount: 2, ticketsUsed: 1, whatsappAvailable: true,
    whatsappStatus: 'SENT',
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: ({ enabled }: { enabled?: boolean }) => ({ data: enabled ? testData.publicOrder : undefined, isLoading: false, error: null }),
}));

vi.mock('@/components/ui/dropdown-menu', async () => {
  const ReactModule = await import('react');
  const DropdownContext = ReactModule.createContext({ open: false, setOpen: (_open: boolean) => {} });
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => {
      const [open, setOpen] = ReactModule.useState(false);
      return ReactModule.createElement(DropdownContext.Provider, { value: { open, setOpen } }, children);
    },
    DropdownMenuTrigger: ({ children }: { children: React.ReactElement }) => {
      const context = ReactModule.useContext(DropdownContext);
      return ReactModule.cloneElement(children, { onClick: () => context.setOpen(true) });
    },
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => {
      const context = ReactModule.useContext(DropdownContext);
      return context.open ? ReactModule.createElement('div', { role: 'menu' }, children) : null;
    },
    DropdownMenuItem: ({ children, onSelect, onClick }: { children: React.ReactNode; onSelect?: () => void; onClick?: () => void }) => {
      const context = ReactModule.useContext(DropdownContext);
      return ReactModule.createElement('button', {
        type: 'button',
        role: 'menuitem',
        onClick: () => {
          onClick?.();
          onSelect?.();
          context.setOpen(false);
        },
      }, children);
    },
    DropdownMenuSeparator: () => null,
  };
});

vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await import('react');
  const DialogContext = ReactModule.createContext(false);
  const passthrough = (tag: 'div' | 'h2' | 'p') => ({ children, ...props }: React.HTMLAttributes<HTMLElement>) =>
    ReactModule.createElement(tag, props, children);
  return {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      ReactModule.createElement(DialogContext.Provider, { value: open }, children),
    DialogContent: ({ children }: { children: React.ReactNode }) => {
      const open = ReactModule.useContext(DialogContext);
      return open ? ReactModule.createElement('div', { role: 'dialog' }, children) : null;
    },
    DialogHeader: passthrough('div'),
    DialogFooter: passthrough('div'),
    DialogTitle: passthrough('h2'),
    DialogDescription: passthrough('p'),
  };
});

vi.mock('@/components/icons/icons', () => ({ MoreVertical: () => null }));
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/features/events/tickets/EditSaleFormDialog', () => ({ EditSaleFormDialog: () => null }));

afterEach(cleanup);

function createSale(source?: TicketSaleDTO['source']): TicketSaleDTO {
  return {
    id: 'sale-1',
    eventId: 'event-1',
    event: { id: 'event-1', name: 'Mostra Escolar', startsAt: '2026-11-14T12:00:00.000Z' },
    lotId: 'lot-1',
    lot: { id: 'lot-1', name: 'Lote Família', ticketType: 'GENERAL' },
    buyerName: 'Ana Costa',
    aluno: null,
    responsavel: null,
    quantity: 2,
    unitPriceSnapshot: 25,
    totalAmount: 50,
    refundedAmount: 0,
    paymentMethod: 'PIX',
    status: 'PAID',
    soldAt: '2026-11-13T12:00:00.000Z',
    paidAt: '2026-11-13T12:05:00.000Z',
    notes: null,
    source,
    eventMapOrderId: source === 'PUBLIC_ORDER' ? 'order-1' : null,
    sessionName: 'Sessão Noturna',
    seats: [{ id: 'seat-1', sectionName: 'Plateia', seatLabel: 'A-04', unitPrice: 25 }],
  };
}

describe('TicketActions order details', () => {
  it.each([
    ['manual sale', undefined],
    ['online order', 'PUBLIC_ORDER' as const],
  ])('opens and closes read-only details for a %s', async (_label, source) => {
    render(<TicketActions sale={createSale(source)} eventId="event-1" lots={[]} />);

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ver detalhes do pedido' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Ana Costa')).toBeTruthy();
    expect(screen.getByText(source === 'PUBLIC_ORDER' ? 'Mapa Principal' : 'Sessão Noturna')).toBeTruthy();
    expect(screen.getByText('Lote Família')).toBeTruthy();
    expect(screen.getByText(/R\$\s?50,00/)).toBeTruthy();
    if (source === 'PUBLIC_ORDER') {
      expect(screen.getByText('ana@example.test')).toBeTruthy();
      expect(screen.getByText('1')).toBeTruthy();
      expect(screen.getByText('Linha do tempo')).toBeTruthy();
      expect(screen.getByText('Setor 1 · A3, Setor 1 · A4')).toBeTruthy();
    } else {
      expect(screen.queryByText('ana@example.test')).toBeNull();
      expect(screen.getByText('Plateia · A-04')).toBeTruthy();
      expect(screen.getByText('Quantidade')).toBeTruthy();
      expect(screen.queryByText('Ingressos utilizados')).toBeNull();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
