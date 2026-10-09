'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Reports } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import type { SchoolEventDTO } from '../events-service';
import { listCostumeAssignments, listCostumes, listTicketSales } from '../events-service';
import { eventQueryKeys } from '../shared/event-query-keys';
import { EVENT_HEADER_ACTION_BUTTON_CLASS, OUTLINE_BUTTON_CLASS } from '../shared/event-form-utils';
import { getCostumeReportMetrics } from '../costumes/costume-report-metrics';
import { getTicketReportMetrics } from '../tickets/ticket-report-metrics';
import { EventReportSummary } from './EventReportSummary';

export function EventReportDialog({
  event,
  participantsCount,
}: {
  event: SchoolEventDTO;
  participantsCount: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const costumesQuery = useQuery({
    queryKey: eventQueryKeys.costumes(event.id),
    queryFn: () => listCostumes(event.id),
    enabled: isOpen && event.hasCostumes,
  });
  const assignmentsQuery = useQuery({
    queryKey: eventQueryKeys.assignments(event.id),
    queryFn: () => listCostumeAssignments(event.id),
    enabled: isOpen && event.hasCostumes,
  });
  const ticketSalesQuery = useQuery({
    queryKey: eventQueryKeys.sales(event.id),
    queryFn: () => listTicketSales(event.id),
    enabled: isOpen && event.hasTickets,
  });
  const publicOrdersQuery = useQuery({
    queryKey: ['events', event.id, 'public-orders', 'report'],
    queryFn: async () => {
      const response = await fetch(`/api/events/${event.id}/public-orders?page=1&pageSize=1`);
      const json = await response.json().catch(() => null) as {
        data?: { summary?: {
          ordersTotal: number;
          waitingPayment: number;
          expired: number;
          issuing: number;
          issuanceFailed: number;
          completed: number;
          refunding: number;
          ticketsIssued: number;
          checkedIn: number;
        } };
        error?: { message?: string };
      } | null;
      if (!response.ok || !json?.data?.summary) {
        throw new Error(json?.error?.message ?? 'Não foi possível carregar os pedidos online.');
      }
      return json.data.summary;
    },
    enabled: isOpen && event.hasTickets,
  });
  const costumeSummary = costumesQuery.data && assignmentsQuery.data
    ? getCostumeReportMetrics(costumesQuery.data, assignmentsQuery.data)
    : null;
  const ticketSummary = ticketSalesQuery.data ? getTicketReportMetrics(ticketSalesQuery.data) : null;
  const costumeSummaryLoading = event.hasCostumes && (costumesQuery.isLoading || assignmentsQuery.isLoading);
  const costumeSummaryError = event.hasCostumes && (costumesQuery.isError || assignmentsQuery.isError);
  const ticketSummaryLoading = event.hasTickets && ticketSalesQuery.isLoading;
  const ticketSummaryError = event.hasTickets && ticketSalesQuery.isError;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className={EVENT_HEADER_ACTION_BUTTON_CLASS}>
          <Reports className="h-4 w-4" />
          Ver relatório
        </Button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[88dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        disableBackdropBlur
        fullScreenMobile
      >
        <div className="shrink-0 border-b border-slate-200 px-5 py-6 sm:px-8">
          <DialogHeader className="space-y-2 pr-6 text-left">
            <DialogTitle>Relatório do evento</DialogTitle>
            <DialogDescription>{event.name} · visão geral operacional e financeira</DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8">
          <EventReportSummary
            event={event}
            participantsCount={participantsCount}
            costumeSummary={costumeSummary}
            costumeSummaryLoading={costumeSummaryLoading}
            costumeSummaryError={costumeSummaryError}
            ticketSummary={ticketSummary}
            ticketSummaryLoading={ticketSummaryLoading}
            ticketSummaryError={ticketSummaryError}
            publicOrdersSummary={publicOrdersQuery.data ?? null}
            publicOrdersSummaryLoading={event.hasTickets && publicOrdersQuery.isLoading}
            publicOrdersSummaryError={event.hasTickets && publicOrdersQuery.isError}
          />
        </div>
        <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 sm:px-8">
          <DialogClose asChild>
            <Button variant="outline" className={`${OUTLINE_BUTTON_CLASS} w-full sm:w-auto`}>Fechar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
