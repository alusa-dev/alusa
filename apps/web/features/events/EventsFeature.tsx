'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  PackageCheck,
  Plus,
  Search,
  Shirt,
  Ticket,
  WalletCards,
  XCircle,
} from 'lucide-react';

import {
  EVENT_COST_CATEGORIES,
  EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS,
  EVENT_COSTUME_CATEGORIES,
  EVENT_COSTUME_CATEGORY_LABELS,
  EVENT_FINANCIAL_STATUS_LABELS,
  EVENT_PAYMENT_METHOD_LABELS,
  EVENT_PAYMENT_METHODS,
  EVENT_TICKET_MODE_LABELS,
  EVENT_TICKET_MODES,
  EVENT_REVENUE_CATEGORIES,
  EVENT_STATUS_LABELS,
  EVENT_TICKET_LOT_STATUS_LABELS,
  EVENT_TICKET_SALE_STATUS_LABELS,
  EVENT_TICKET_TYPE_LABELS,
  EVENT_TICKET_TYPES,
  EVENT_TYPE_LABELS,
  SCHOOL_EVENT_TYPES,
  type EventCostumeAssignmentStatus,
  type EventFinancialEntryStatus,
  type EventFinancialEntryType,
  type EventTicketSaleStatus,
  type SchoolEventStatus,
} from '@alusa/shared';

import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import TableLayout from '@/components/layout/TableLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import {
  cancelTicketSale,
  createCostume,
  createCostumeAssignment,
  createFinancialEntry,
  createTicketLot,
  createTicketSale,
  type EventListResult,
  formatCurrency,
  formatDate,
  formatDateTime,
  getEvent,
  getEventReports,
  listCostumeAssignments,
  listCostumes,
  listEventAudit,
  listEvents,
  listFinancialEntries,
  listResources,
  listTicketLots,
  listTicketSales,
  markTicketSalePaid,
  refundTicketSale,
  saveEvent,
  updateCostumeAssignment,
  updateEventStatus,
  updateFinancialEntry,
  updateTicketLot,
  type CostumeAssignmentDTO,
  type CostumeDTO,
  type EventResources,
  type EventReportsDTO,
  type FinancialEntryDTO,
  type SchoolEventDTO,
  type TicketLotDTO,
  type TicketSaleDTO,
} from './events-service';
import { EventMapPanel } from './map/components/EventMapPanel';

type Option = { value: string; label: string };
const EMPTY_SELECT_VALUE = '__EVENTS_EMPTY__';

const eventQueryKeys = {
  events: ['events'] as const,
  resources: ['events', 'resources'] as const,
  event: (id: string) => ['events', 'detail', id] as const,
  lots: (id?: string) => ['events', 'lots', id ?? 'all'] as const,
  sales: (id?: string) => ['events', 'sales', id ?? 'all'] as const,
  costumes: (id?: string) => ['events', 'costumes', id ?? 'all'] as const,
  assignments: (id?: string) => ['events', 'assignments', id ?? 'all'] as const,
  finance: (id?: string, type?: string) => ['events', 'finance', id ?? 'all', type ?? 'all'] as const,
  reports: (eventId?: string, compareWithEventId?: string) =>
    ['events', 'reports', eventId ?? 'all', compareWithEventId ?? 'none'] as const,
  audit: (id: string) => ['events', 'audit', id] as const,
};

const FILTER_INPUT_CLASS =
  'h-10 rounded-lg border-slate-200 bg-white text-sm shadow-none focus-visible:ring-brand-accent/30';
const SELECT_CLASS =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-none outline-none focus:ring-2 focus:ring-brand-accent/25';
const LABEL_CLASS = 'text-xs font-medium text-slate-600';
const PRIMARY_BUTTON_CLASS = 'h-10 bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90';
const OUTLINE_BUTTON_CLASS = 'h-10 border-slate-200 bg-white px-4 text-slate-700 shadow-sm shadow-slate-200/40 hover:bg-slate-50';
const SMALL_OUTLINE_BUTTON_CLASS = 'h-8 border-slate-200 bg-white px-3 text-xs text-slate-700 shadow-sm shadow-slate-200/40 hover:bg-slate-50';
const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const hour = String(Math.floor(index / 4)).padStart(2, '0');
  const minute = String((index % 4) * 15).padStart(2, '0');
  return `${hour}:${minute}`;
});

function toDatetimeLocal(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toDateOnly(value?: string | null) {
  const local = toDatetimeLocal(value);
  return local ? local.slice(0, 10) : '';
}

function toTimeOnly(value?: string | null) {
  const local = toDatetimeLocal(value);
  return local ? local.slice(11, 16) : '';
}

function formatDateInputValue(date?: Date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function datetimeValue(form: FormData, key: string) {
  const raw = String(form.get(key) ?? '').trim();
  return raw ? new Date(raw).toISOString() : undefined;
}

function nullableString(form: FormData, key: string) {
  const raw = String(form.get(key) ?? '').trim();
  return raw || undefined;
}

function numberValue(form: FormData, key: string) {
  const raw = String(form.get(key) ?? '').replace(',', '.').trim();
  return raw ? Number(raw) : undefined;
}

function booleanValue(form: FormData, key: string) {
  return form.get(key) === 'on';
}

function NativeSelect({
  name,
  defaultValue,
  options,
  required,
  placeholder,
}: {
  name: string;
  defaultValue?: string | null;
  options: Option[];
  required?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? '');
  return (
    <>
      <input type="hidden" name={name} value={value} required={required} />
      <Select value={value || undefined} onValueChange={(next) => setValue(next === EMPTY_SELECT_VALUE ? '' : next)}>
        <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white text-sm text-slate-900 shadow-none">
          <SelectValue placeholder={placeholder ?? 'Selecione'} />
        </SelectTrigger>
        <SelectContent className="text-[13px]">
          {placeholder && !required ? <SelectItem value={EMPTY_SELECT_VALUE}>{placeholder}</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function DateTimeField({
  name,
  defaultValue,
  required,
}: {
  name: string;
  defaultValue?: string | null;
  required?: boolean;
}) {
  const [date, setDate] = useState<Date | undefined>(() => {
    const raw = toDateOnly(defaultValue);
    if (!raw) return undefined;
    const [year, month, day] = raw.split('-').map(Number);
    return new Date(year, month - 1, day);
  });
  const [time, setTime] = useState(() => toTimeOnly(defaultValue));
  const dateValue = formatDateInputValue(date);
  const value = dateValue ? `${dateValue}T${time || '00:00'}` : '';

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_112px]">
      <input type="hidden" name={name} value={value} required={required} />
      <DatePicker
        value={date}
        onChange={setDate}
        variant="input"
        placeholder="dd/mm/aaaa"
        className={FILTER_INPUT_CLASS}
        readOnlyInput
      />
      <Select value={time || undefined} onValueChange={setTime}>
        <SelectTrigger aria-label="Horário" className="h-10 w-full rounded-lg border-slate-200 bg-white text-sm text-slate-900 shadow-none">
          <SelectValue placeholder="--:--" />
        </SelectTrigger>
        <SelectContent className="max-h-72 text-[13px]">
          {TIME_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

function MetricCard({
  label,
  value,
  icon: _icon,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  icon?: typeof BarChart3;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  void tone;

  return (
    <Card className="rounded-xl border-0 bg-brand-accent/10 p-4 text-purple-950 shadow-none">
      <div className="min-w-0">
        <p className="text-sm font-medium opacity-85">{label}</p>
        <div className="mt-1 truncate text-2xl font-semibold tracking-tight">{value}</div>
      </div>
    </Card>
  );
}

function StatusBadge({ status }: { status: SchoolEventStatus }) {
  const variant =
    status === 'ACTIVE'
      ? 'success'
      : status === 'PLANNING'
        ? 'info'
        : status === 'CANCELLED'
          ? 'destructive'
          : status === 'FINISHED'
            ? 'neutral'
            : 'outline';

  return <Badge variant={variant}>{EVENT_STATUS_LABELS[status]}</Badge>;
}

function SoftBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }) {
  const className = {
    neutral: 'bg-slate-100 text-slate-700',
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    danger: 'bg-rose-50 text-rose-700',
    info: 'bg-violet-50 text-violet-700',
  }[tone];
  return <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', className)}>{children}</span>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  );
}

function TablePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="alusa-session-panel w-full overflow-hidden rounded-lg border border-slate-200 bg-white outline-none ring-0 ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)] md:rounded-xl">
      {children}
    </div>
  );
}

function useEventResources() {
  return useQuery({
    queryKey: eventQueryKeys.resources,
    queryFn: listResources,
    staleTime: 60_000,
  });
}

function EventFormDialog({
  event,
  trigger,
  onSaved,
}: {
  event?: SchoolEventDTO | null;
  trigger: React.ReactNode;
  onSaved?: (event: SchoolEventDTO) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const resources = useEventResources();
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => saveEvent(payload, event?.id),
    onSuccess: async (saved) => {
      toast.success({ title: event ? 'Evento atualizado' : 'Evento criado' });
      await queryClient.invalidateQueries({ queryKey: eventQueryKeys.events });
      if (event?.id) await queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(event.id) });
      setOpen(false);
      onSaved?.(saved);
    },
    onError: (error) => toast.error({ title: 'Erro ao salvar evento', description: (error as Error).message }),
  });

  function handleSubmit(formData: FormData) {
    mutation.mutate({
      name: nullableString(formData, 'name'),
      type: nullableString(formData, 'type'),
      description: nullableString(formData, 'description'),
      startsAt: datetimeValue(formData, 'startsAt'),
      endsAt: datetimeValue(formData, 'endsAt'),
      locationName: nullableString(formData, 'locationName'),
      locationAddress: nullableString(formData, 'locationAddress'),
      estimatedCapacity: numberValue(formData, 'estimatedCapacity'),
      responsibleUserId: nullableString(formData, 'responsibleUserId'),
      hasTickets: booleanValue(formData, 'hasTickets'),
      ticketMode: nullableString(formData, 'ticketMode'),
      hasCostumes: booleanValue(formData, 'hasCostumes'),
      hasFinancialControl: booleanValue(formData, 'hasFinancialControl'),
      notes: nullableString(formData, 'notes'),
    });
  }

  const userOptions = (resources.data?.users ?? []).map((user) => ({ value: user.id, label: user.nome }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        fullScreenMobile
        className="max-w-4xl w-full gap-0 overflow-hidden bg-slate-50 p-0 alusa-dark:bg-[color:var(--color-bg-card)] max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 md:rounded-2xl"
      >
        <form action={handleSubmit} className="flex max-h-[88vh] min-h-0 flex-col max-md:max-h-none max-md:flex-1">
          <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)] md:px-8 md:py-6">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
            <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0 alusa-dark:text-[color:var(--color-text-primary)]">
              {event ? 'Editar evento' : 'Novo evento'}
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-2xl text-sm text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
              Organize os dados básicos e as configurações operacionais do evento.
            </DialogDescription>
          </div>
          <div className="flex-1 space-y-6 overflow-y-auto scroll-smooth bg-slate-50 px-4 py-6 max-md:min-h-0 alusa-dark:bg-transparent md:px-8">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
              <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Dados básicos</span>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                  <Field label="Nome do evento">
                    <Input name="name" defaultValue={event?.name ?? ''} required className={FILTER_INPUT_CLASS} />
                  </Field>
                </div>
                <Field label="Tipo">
                  <NativeSelect
                    name="type"
                    required
                    defaultValue={event?.type ?? 'PRESENTATION'}
                    options={SCHOOL_EVENT_TYPES.map((type) => ({ value: type, label: EVENT_TYPE_LABELS[type] }))}
                  />
                </Field>
                <Field label="Início">
                  <DateTimeField name="startsAt" defaultValue={event?.startsAt} required />
                </Field>
                <Field label="Fim">
                  <DateTimeField name="endsAt" defaultValue={event?.endsAt} />
                </Field>
                <Field label="Capacidade estimada">
                  <Input type="number" min={1} name="estimatedCapacity" defaultValue={event?.estimatedCapacity ?? ''} className={FILTER_INPUT_CLASS} />
                </Field>
                <Field label="Local">
                  <Input name="locationName" defaultValue={event?.locationName ?? ''} className={FILTER_INPUT_CLASS} />
                </Field>
                <Field label="Endereço">
                  <Input name="locationAddress" defaultValue={event?.locationAddress ?? ''} className={FILTER_INPUT_CLASS} />
                </Field>
                <Field label="Responsável interno">
                  <NativeSelect
                    name="responsibleUserId"
                    defaultValue={event?.responsibleUserId}
                    placeholder="Sem responsável"
                    options={userOptions}
                  />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Descrição">
                  <Textarea name="description" defaultValue={event?.description ?? ''} className="min-h-20 rounded-lg border-slate-200 shadow-none" />
                </Field>
              </div>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/40 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
              <span className="text-sm font-semibold text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Configurações</span>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {[
                  ['hasTickets', 'Terá ingressos?', event?.hasTickets ?? false],
                  ['hasCostumes', 'Terá figurinos?', event?.hasCostumes ?? false],
                  ['hasFinancialControl', 'Controle financeiro?', event?.hasFinancialControl ?? true],
                ].map(([name, label, checked]) => (
                  <label key={String(name)} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
                    <input name={String(name)} type="checkbox" defaultChecked={Boolean(checked)} className="h-4 w-4 rounded border-slate-300 accent-violet-700" />
                    {label}
                  </label>
                ))}
              </div>
              <div className="mt-4 max-w-sm">
                <Field label="Tipo de ingresso">
                  <NativeSelect
                    name="ticketMode"
                    defaultValue={event?.ticketMode ?? (event?.hasTickets ? 'SIMPLE' : 'NONE')}
                    options={EVENT_TICKET_MODES.map((mode) => ({ value: mode, label: EVENT_TICKET_MODE_LABELS[mode] }))}
                  />
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Observações">
                  <Textarea name="notes" defaultValue={event?.notes ?? ''} className="min-h-20 rounded-lg border-slate-200 shadow-none" />
                </Field>
              </div>
            </section>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-4 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)] md:px-8">
            <Button type="button" variant="outline" className={cn(OUTLINE_BUTTON_CLASS, 'min-w-32')} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending} className={cn(PRIMARY_BUTTON_CLASS, 'min-w-40')}>
              {mutation.isPending ? 'Salvando...' : 'Salvar evento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EventsKpis({ events, summary }: { events: SchoolEventDTO[]; summary?: EventListResult['summary'] }) {
  const active = summary?.active ?? events.filter((event) => event.status === 'ACTIVE').length;
  const planning = summary?.planning ?? events.filter((event) => event.status === 'PLANNING').length;
  const revenue = summary?.receitaRealizada ?? events.reduce((sum, event) => sum + event.metrics.receitaRealizada, 0);
  const cost = summary?.custoRealizado ?? events.reduce((sum, event) => sum + event.metrics.custoRealizado, 0);
  const result = events.reduce((sum, event) => sum + event.metrics.resultadoRealizado, 0);

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <MetricCard label="Eventos ativos" value={active} icon={CalendarDays} tone="success" />
      <MetricCard label="Em planejamento" value={planning} icon={ClipboardList} tone="info" />
      <MetricCard label="Receita realizada" value={formatCurrency(revenue)} icon={CircleDollarSign} tone="success" />
      <MetricCard label="Custos pagos" value={formatCurrency(cost)} icon={WalletCards} tone="warning" />
      <MetricCard label="Resultado realizado" value={formatCurrency(result)} icon={BarChart3} tone={result >= 0 ? 'success' : 'danger'} />
    </div>
  );
}

export function EventsFeature() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [type, setType] = useState('ALL');
  const query = useQuery({
    queryKey: [...eventQueryKeys.events, search, status, type],
    queryFn: () => listEvents({
      search,
      status: status === 'ALL' ? undefined : status,
      type: type === 'ALL' ? undefined : type,
      pageSize: 50,
    }),
  });

  const events = query.data?.data ?? [];

  const columns = useMemo<DataTableColumn<SchoolEventDTO>[]>(
    () => [
      {
        id: 'event',
        header: 'Evento',
        width: 'w-[30%]',
        align: 'left',
        cellClassName: 'min-w-0',
        render: (event) => (
          <div className="min-w-0">
            <Link href={`/events/${event.id}`} className="font-medium text-slate-950 hover:text-brand-accent">
              {event.name}
            </Link>
            <p className="mt-1 truncate text-xs text-slate-500">{event.locationName || 'Local não definido'}</p>
          </div>
        ),
      },
      {
        id: 'type',
        header: 'Tipo',
        width: 'w-[13%]',
        align: 'left',
        render: (event) => <span className="text-slate-700">{EVENT_TYPE_LABELS[event.type]}</span>,
      },
      {
        id: 'date',
        header: 'Data',
        width: 'w-[12%]',
        align: 'left',
        render: (event) => <span className="text-slate-700">{formatDate(event.startsAt)}</span>,
      },
      {
        id: 'status',
        header: 'Status',
        width: 'w-[12%]',
        align: 'center',
        render: (event) => <StatusBadge status={event.status} />,
      },
      {
        id: 'tickets',
        header: 'Ingressos',
        width: 'w-[10%]',
        align: 'right',
        render: (event) => <span className="font-medium text-slate-900">{event.metrics.ingressosVendidos}</span>,
      },
      {
        id: 'revenue',
        header: 'Receita',
        width: 'w-[11%]',
        align: 'right',
        render: (event) => <span className="font-medium text-slate-900">{formatCurrency(event.metrics.receitaRealizada)}</span>,
      },
      {
        id: 'result',
        header: 'Resultado',
        width: 'w-[12%]',
        align: 'right',
        render: (event) => (
          <span className={event.metrics.resultadoRealizado >= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
            {formatCurrency(event.metrics.resultadoRealizado)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <TableLayout
      title="Eventos"
      subtitle="Gerencie eventos escolares, ingressos, figurinos, custos, receitas e resultados em um só lugar."
      actions={
        <EventFormDialog
          trigger={
            <Button className={cn(PRIMARY_BUTTON_CLASS, 'w-full md:w-auto')}>
              <Plus className="mr-2 h-4 w-4 transition-none" />
              Novo evento
            </Button>
          }
          onSaved={(event) => router.push(`/events/${event.id}`)}
        />
      }
      filtersBar={
        <div className="flex w-full flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-end lg:gap-2">
          <div className="relative w-full min-w-0 shrink-0 lg:w-[360px] xl:w-[420px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome ou local"
              className={cn(FILTER_INPUT_CLASS, 'pl-10')}
            />
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2 lg:contents">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-10 w-full min-w-0 border-slate-200 bg-white shadow-none lg:w-[170px]">
                <SelectValue placeholder="Todos os status" />
              </SelectTrigger>
              <SelectContent align="end" className="text-[13px]">
                <SelectItem value="ALL">Todos os status</SelectItem>
                {Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-10 w-full min-w-0 border-slate-200 bg-white shadow-none lg:w-[170px]">
                <SelectValue placeholder="Todos os tipos" />
              </SelectTrigger>
              <SelectContent align="end" className="text-[13px]">
                <SelectItem value="ALL">Todos os tipos</SelectItem>
                {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <EventsKpis events={events} summary={query.data?.summary} />
        <TablePanel>
          <DataTable
            columns={columns}
            data={events}
            rowKey={(event) => event.id}
            loading={query.isLoading}
            onRowClick={(event) => router.push(`/events/${event.id}`)}
            emptyMessage={
              <EmptyState
                title="Nenhum evento criado ainda."
                description="Crie o primeiro evento para organizar ingressos, figurinos, custos e receitas em um só lugar."
              />
            }
          />
        </TablePanel>
      </div>
    </TableLayout>
  );
}

export function NewEventFeature() {
  const router = useRouter();

  return (
    <TableLayout
      title="Novo evento"
      subtitle="Crie a pasta operacional do evento e depois configure ingressos, figurinos, custos e receitas."
      className="pr-4 xl:pr-6"
    >
      <Card className="max-w-2xl rounded-xl border-slate-200 bg-white p-6 shadow-none">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">Dados básicos do evento</h2>
          <p className="text-sm text-slate-500">
            O evento nasce em planejamento para evitar lançamentos em eventos errados.
          </p>
        </div>
        <div className="mt-5">
          <EventFormDialog
            trigger={
              <Button className="rounded-xl">
                <Plus className="h-4 w-4" />
                Abrir formulário
              </Button>
            }
            onSaved={(event) => router.push(`/events/${event.id}`)}
          />
        </div>
      </Card>
    </TableLayout>
  );
}

function EventHeader({ event }: { event: SchoolEventDTO }) {
  const queryClient = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: (status: SchoolEventStatus) => updateEventStatus(event.id, status),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(event.id) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.events }),
      ]);
      toast.success({ title: 'Status atualizado' });
    },
    onError: (error) => toast.error({ title: 'Erro ao alterar status', description: (error as Error).message }),
  });

  const nextActions: Array<{ status: SchoolEventStatus; label: string; icon: typeof CheckCircle2 }> = [
    ...(event.status === 'PLANNING' ? [{ status: 'ACTIVE' as const, label: 'Ativar', icon: CheckCircle2 }] : []),
    ...(event.status === 'ACTIVE' ? [{ status: 'FINISHED' as const, label: 'Finalizar', icon: CheckCircle2 }] : []),
    ...(['PLANNING', 'ACTIVE'].includes(event.status) ? [{ status: 'CANCELLED' as const, label: 'Cancelar', icon: XCircle }] : []),
    ...(['FINISHED', 'CANCELLED'].includes(event.status) ? [{ status: 'ARCHIVED' as const, label: 'Arquivar', icon: PackageCheck }] : []),
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm shadow-slate-200/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold tracking-tight text-slate-950 md:text-2xl">{event.name}</h1>
            <StatusBadge status={event.status} />
            <SoftBadge tone="info">{EVENT_TYPE_LABELS[event.type]}</SoftBadge>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {formatDateTime(event.startsAt)} · {event.locationName || 'Local não definido'} · {event.responsibleUser?.nome || 'Sem responsável'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <EventFormDialog event={event} trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}>Editar</Button>} />
          {nextActions.map((action) => (
            <Button
              key={action.status}
              variant="outline"
              className={cn(
                OUTLINE_BUTTON_CLASS,
                action.status === 'CANCELLED' && 'text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700',
              )}
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate(action.status)}
            >
              <action.icon className="h-4 w-4" />
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EventSummary({ event }: { event: SchoolEventDTO }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Receita prevista" value={formatCurrency(event.metrics.receitaPrevista)} icon={CircleDollarSign} tone="info" />
        <MetricCard label="Receita recebida" value={formatCurrency(event.metrics.receitaRealizada)} icon={CircleDollarSign} tone="success" />
        <MetricCard label="Custos previstos" value={formatCurrency(event.metrics.custoPrevisto)} icon={WalletCards} tone="warning" />
        <MetricCard label="Resultado realizado" value={formatCurrency(event.metrics.resultadoRealizado)} icon={BarChart3} tone={event.metrics.resultadoRealizado >= 0 ? 'success' : 'danger'} />
        <MetricCard label="Ingressos vendidos" value={event.metrics.ingressosVendidos} icon={Ticket} />
        <MetricCard label="Figurinos pendentes" value={event.metrics.figurinosPendentes} icon={Shirt} tone="warning" />
        <MetricCard label="Ticket médio" value={event.metrics.ticketMedio == null ? '-' : formatCurrency(event.metrics.ticketMedio)} icon={Ticket} />
        <MetricCard label="Taxa de ocupação" value={event.metrics.taxaOcupacao == null ? '-' : `${Math.round(event.metrics.taxaOcupacao * 100)}%`} icon={BarChart3} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-xl border-slate-200 p-5 shadow-none lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-950">Dados do evento</h2>
          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div><dt className="text-slate-500">Período</dt><dd className="font-medium text-slate-900">{formatDateTime(event.startsAt)} até {formatDateTime(event.endsAt)}</dd></div>
            <div><dt className="text-slate-500">Local</dt><dd className="font-medium text-slate-900">{event.locationName || '-'}</dd></div>
            <div><dt className="text-slate-500">Capacidade</dt><dd className="font-medium text-slate-900">{event.estimatedCapacity ?? '-'}</dd></div>
            <div><dt className="text-slate-500">Responsável</dt><dd className="font-medium text-slate-900">{event.responsibleUser?.nome || '-'}</dd></div>
          </dl>
        </Card>
        <Card className="rounded-xl border-slate-200 p-5 shadow-none">
          <h2 className="text-sm font-semibold text-slate-950">Configurações</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <SoftBadge tone={event.hasTickets ? 'success' : 'neutral'}>Ingressos</SoftBadge>
            <SoftBadge tone={event.hasCostumes ? 'success' : 'neutral'}>Figurinos</SoftBadge>
            <SoftBadge tone={event.hasFinancialControl ? 'success' : 'neutral'}>Financeiro</SoftBadge>
          </div>
          {event.notes ? <p className="mt-4 text-sm text-slate-600">{event.notes}</p> : null}
        </Card>
      </div>
    </div>
  );
}

function LotFormDialog({ eventId, trigger, lot }: { eventId: string; trigger: React.ReactNode; lot?: TicketLotDTO }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => (lot ? updateTicketLot(lot.id, payload) : createTicketLot(payload)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: lot ? 'Lote atualizado' : 'Lote criado' });
    },
    onError: (error) => toast.error({ title: 'Erro no lote', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    mutation.mutate({
      eventId,
      name: nullableString(formData, 'name'),
      ticketType: nullableString(formData, 'ticketType'),
      unitPrice: numberValue(formData, 'unitPrice') ?? 0,
      quantityTotal: numberValue(formData, 'quantityTotal'),
      saleStartsAt: datetimeValue(formData, 'saleStartsAt'),
      saleEndsAt: datetimeValue(formData, 'saleEndsAt'),
      status: nullableString(formData, 'status') ?? 'DRAFT',
      notes: nullableString(formData, 'notes'),
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lot ? 'Editar lote' : 'Novo lote'}</DialogTitle>
          <DialogDescription>Configure estoque, valor e período de vendas.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome do lote"><Input name="name" defaultValue={lot?.name ?? ''} required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Tipo"><NativeSelect name="ticketType" defaultValue={lot?.ticketType ?? 'FULL'} options={EVENT_TICKET_TYPES.map((type) => ({ value: type, label: EVENT_TICKET_TYPE_LABELS[type] }))} required /></Field>
            <Field label="Valor unitário"><Input name="unitPrice" type="number" min={0} step="0.01" defaultValue={lot?.unitPrice ?? 0} required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Quantidade"><Input name="quantityTotal" type="number" min={1} defaultValue={lot?.quantityTotal ?? 1} required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Início das vendas"><DateTimeField name="saleStartsAt" defaultValue={lot?.saleStartsAt} /></Field>
            <Field label="Fim das vendas"><DateTimeField name="saleEndsAt" defaultValue={lot?.saleEndsAt} /></Field>
            <Field label="Status"><NativeSelect name="status" defaultValue={lot?.status ?? 'DRAFT'} options={Object.entries(EVENT_TICKET_LOT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
          </div>
          <Field label="Observações"><Textarea name="notes" defaultValue={lot?.notes ?? ''} className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>Salvar lote</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SaleFormDialog({ eventId, lots, resources, trigger }: { eventId: string; lots: TicketLotDTO[]; resources?: EventResources; trigger: React.ReactNode }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: createTicketSale,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.sales(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Venda registrada' });
    },
    onError: (error) => toast.error({ title: 'Erro na venda', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    mutation.mutate({
      eventId,
      lotId: nullableString(formData, 'lotId'),
      buyerName: nullableString(formData, 'buyerName'),
      alunoId: nullableString(formData, 'alunoId'),
      responsavelId: nullableString(formData, 'responsavelId'),
      quantity: numberValue(formData, 'quantity') ?? 1,
      paymentMethod: nullableString(formData, 'paymentMethod'),
      status: nullableString(formData, 'status'),
      soldAt: datetimeValue(formData, 'soldAt'),
      notes: nullableString(formData, 'notes'),
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Registrar venda manual</DialogTitle>
          <DialogDescription>A venda valida estoque no backend e salva o preço como snapshot.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Lote"><NativeSelect name="lotId" required placeholder="Selecione" options={lots.filter((lot) => lot.status === 'ACTIVE').map((lot) => ({ value: lot.id, label: `${lot.name} · ${formatCurrency(lot.unitPrice)} · ${lot.quantityAvailable} disp.` }))} /></Field>
            <Field label="Comprador"><Input name="buyerName" required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Aluno vinculado"><NativeSelect name="alunoId" placeholder="Opcional" options={(resources?.alunos ?? []).map((item) => ({ value: item.id, label: item.nome }))} /></Field>
            <Field label="Responsável vinculado"><NativeSelect name="responsavelId" placeholder="Opcional" options={(resources?.responsaveis ?? []).map((item) => ({ value: item.id, label: item.nome }))} /></Field>
            <Field label="Quantidade"><Input name="quantity" type="number" min={1} defaultValue={1} required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Forma de pagamento"><NativeSelect name="paymentMethod" defaultValue="MANUAL_PIX" options={EVENT_PAYMENT_METHODS.map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))} /></Field>
            <Field label="Status"><NativeSelect name="status" defaultValue="PENDING" options={(['PENDING', 'PAID', 'COMPLIMENTARY'] as EventTicketSaleStatus[]).map((status) => ({ value: status, label: EVENT_TICKET_SALE_STATUS_LABELS[status] }))} /></Field>
            <Field label="Data da venda"><DateTimeField name="soldAt" /></Field>
          </div>
          <Field label="Observações"><Textarea name="notes" className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>Registrar venda</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TicketActions({ sale, eventId }: { sale: TicketSaleDTO; eventId: string }) {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.sales(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
    ]);
  };
  const paid = useMutation({ mutationFn: () => markTicketSalePaid(sale.id), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: () => cancelTicketSale(sale.id), onSuccess: invalidate });
  const refund = useMutation({ mutationFn: () => refundTicketSale(sale.id), onSuccess: invalidate });

  return (
    <div className="flex justify-end gap-2">
      {sale.status === 'PENDING' ? <Button size="sm" variant="outline" className={SMALL_OUTLINE_BUTTON_CLASS} onClick={() => paid.mutate()}>Pago</Button> : null}
      {sale.status === 'PENDING' || sale.status === 'COMPLIMENTARY' ? <Button size="sm" variant="outline" className={SMALL_OUTLINE_BUTTON_CLASS} onClick={() => cancel.mutate()}>Cancelar</Button> : null}
      {sale.status === 'PAID' ? <Button size="sm" variant="outline" className={SMALL_OUTLINE_BUTTON_CLASS} onClick={() => refund.mutate()}>Estornar</Button> : null}
    </div>
  );
}

function EventTicketsPanel({ eventId, resources }: { eventId: string; resources?: EventResources }) {
  const lots = useQuery({ queryKey: eventQueryKeys.lots(eventId), queryFn: () => listTicketLots(eventId) });
  const sales = useQuery({ queryKey: eventQueryKeys.sales(eventId), queryFn: () => listTicketSales(eventId) });
  const lotRows = lots.data ?? [];
  const saleRows = sales.data ?? [];
  const revenue = saleRows.filter((sale) => sale.status === 'PAID').reduce((sum, sale) => sum + sale.totalAmount, 0);
  const pending = saleRows.filter((sale) => sale.status === 'PENDING').reduce((sum, sale) => sum + sale.totalAmount, 0);
  const complimentary = saleRows.filter((sale) => sale.status === 'COMPLIMENTARY').reduce((sum, sale) => sum + sale.quantity, 0);

  return (
    <Tabs defaultValue="lots" variant="line" className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <TabsList className="overflow-x-auto"><TabsTrigger value="lots">Lotes</TabsTrigger><TabsTrigger value="sales">Vendas</TabsTrigger><TabsTrigger value="metrics">Métricas</TabsTrigger></TabsList>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <LotFormDialog eventId={eventId} trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}><Plus className="h-4 w-4" /> Lote</Button>} />
          <SaleFormDialog eventId={eventId} lots={lotRows} resources={resources} trigger={<Button className={PRIMARY_BUTTON_CLASS}><Plus className="h-4 w-4" /> Venda</Button>} />
        </div>
      </div>
      <TabsContent value="lots">
        <TablePanel>
          <DataTable
            columns={[
              { id: 'name', header: 'Lote', width: 'w-[24%]', align: 'left', render: (lot: TicketLotDTO) => <span className="font-medium text-slate-950">{lot.name}</span> },
              { id: 'type', header: 'Tipo', width: 'w-[16%]', align: 'left', render: (lot: TicketLotDTO) => EVENT_TICKET_TYPE_LABELS[lot.ticketType] },
              { id: 'price', header: 'Valor', width: 'w-[15%]', align: 'right', render: (lot: TicketLotDTO) => formatCurrency(lot.unitPrice) },
              { id: 'stock', header: 'Vendido/Total', width: 'w-[18%]', align: 'right', render: (lot: TicketLotDTO) => `${lot.quantitySold}/${lot.quantityTotal}` },
              { id: 'status', header: 'Status', width: 'w-[15%]', align: 'center', render: (lot: TicketLotDTO) => <SoftBadge>{EVENT_TICKET_LOT_STATUS_LABELS[lot.status]}</SoftBadge> },
              { id: 'actions', header: 'Ações', width: 'w-[12%]', align: 'right', render: (lot: TicketLotDTO) => <LotFormDialog eventId={eventId} lot={lot} trigger={<Button size="sm" variant="outline" className={SMALL_OUTLINE_BUTTON_CLASS}>Editar</Button>} /> },
            ]}
            data={lotRows}
            rowKey={(lot) => lot.id}
            loading={lots.isLoading}
            emptyMessage={<EmptyState title="Nenhum lote criado." description="Crie um lote para começar a registrar vendas de ingressos deste evento." />}
          />
        </TablePanel>
      </TabsContent>
      <TabsContent value="sales">
        <TablePanel>
          <DataTable
            columns={[
              { id: 'buyer', header: 'Comprador', width: 'w-[22%]', align: 'left', render: (sale: TicketSaleDTO) => <span className="font-medium text-slate-950">{sale.buyerName}</span> },
              { id: 'lot', header: 'Lote', width: 'w-[16%]', align: 'left', render: (sale: TicketSaleDTO) => sale.lot.name },
              { id: 'qty', header: 'Qtd.', width: 'w-[9%]', align: 'right', render: (sale: TicketSaleDTO) => sale.quantity },
              { id: 'total', header: 'Total', width: 'w-[14%]', align: 'right', render: (sale: TicketSaleDTO) => formatCurrency(sale.totalAmount) },
              { id: 'status', header: 'Status', width: 'w-[14%]', align: 'center', render: (sale: TicketSaleDTO) => <SoftBadge>{EVENT_TICKET_SALE_STATUS_LABELS[sale.status]}</SoftBadge> },
              { id: 'date', header: 'Data', width: 'w-[13%]', align: 'left', render: (sale: TicketSaleDTO) => formatDate(sale.soldAt) },
              { id: 'actions', header: 'Ações', width: 'w-[12%]', align: 'right', render: (sale: TicketSaleDTO) => <TicketActions sale={sale} eventId={eventId} /> },
            ]}
            data={saleRows}
            rowKey={(sale) => sale.id}
            loading={sales.isLoading}
            emptyMessage={<EmptyState title="Nenhuma venda registrada." description="Registre vendas manuais vinculadas a um lote deste evento." />}
          />
        </TablePanel>
      </TabsContent>
      <TabsContent value="metrics">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Receita recebida" value={formatCurrency(revenue)} icon={CircleDollarSign} tone="success" />
          <MetricCard label="Receita pendente" value={formatCurrency(pending)} icon={WalletCards} tone="warning" />
          <MetricCard label="Ingressos vendidos" value={saleRows.reduce((sum, sale) => sum + sale.quantity, 0)} icon={Ticket} />
          <MetricCard label="Cortesias" value={complimentary} icon={Ticket} tone="info" />
        </div>
      </TabsContent>
    </Tabs>
  );
}

function CostumeFormDialog({ eventId, trigger }: { eventId: string; trigger: React.ReactNode }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: createCostume,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.costumes(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Figurino cadastrado' });
    },
    onError: (error) => toast.error({ title: 'Erro no figurino', description: (error as Error).message }),
  });
  function submit(formData: FormData) {
    mutation.mutate({
      eventId,
      name: nullableString(formData, 'name'),
      category: nullableString(formData, 'category'),
      size: nullableString(formData, 'size'),
      color: nullableString(formData, 'color'),
      accessories: nullableString(formData, 'accessories'),
      schoolCost: numberValue(formData, 'schoolCost'),
      chargedValue: numberValue(formData, 'chargedValue'),
      supplier: nullableString(formData, 'supplier'),
      quantity: numberValue(formData, 'quantity') ?? 1,
      description: nullableString(formData, 'description'),
    });
  }
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Novo figurino</DialogTitle><DialogDescription>Cadastre peças, custos e valores cobrados.</DialogDescription></DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome"><Input name="name" required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Categoria"><NativeSelect name="category" defaultValue="CLOTHING" options={EVENT_COSTUME_CATEGORIES.map((category) => ({ value: category, label: EVENT_COSTUME_CATEGORY_LABELS[category] }))} /></Field>
            <Field label="Tamanho"><Input name="size" className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Cor"><Input name="color" className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Custo escola"><Input name="schoolCost" type="number" step="0.01" min={0} className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Valor cobrado"><Input name="chargedValue" type="number" step="0.01" min={0} className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Quantidade"><Input name="quantity" type="number" min={1} defaultValue={1} className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Fornecedor"><Input name="supplier" className={FILTER_INPUT_CLASS} /></Field>
          </div>
          <Field label="Acessórios inclusos"><Input name="accessories" className={FILTER_INPUT_CLASS} /></Field>
          <Field label="Descrição"><Textarea name="description" className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit">Salvar figurino</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentFormDialog({ eventId, costumes, resources, trigger }: { eventId: string; costumes: CostumeDTO[]; resources?: EventResources; trigger: React.ReactNode }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: createCostumeAssignment,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Entrega cadastrada' });
    },
    onError: (error) => toast.error({ title: 'Erro na entrega', description: (error as Error).message }),
  });
  function submit(formData: FormData) {
    mutation.mutate({
      eventId,
      costumeId: nullableString(formData, 'costumeId'),
      alunoId: nullableString(formData, 'alunoId'),
      turmaId: nullableString(formData, 'turmaId'),
      definedSize: nullableString(formData, 'definedSize'),
      status: nullableString(formData, 'status'),
      chargedValue: numberValue(formData, 'chargedValue'),
      isPaid: booleanValue(formData, 'isPaid'),
      notes: nullableString(formData, 'notes'),
    });
  }
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Vincular figurino</DialogTitle><DialogDescription>Acompanhe aluno, turma, entrega, devolução e pagamento.</DialogDescription></DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Figurino"><NativeSelect name="costumeId" required placeholder="Selecione" options={costumes.map((item) => ({ value: item.id, label: item.name }))} /></Field>
            <Field label="Aluno"><NativeSelect name="alunoId" placeholder="Opcional" options={(resources?.alunos ?? []).map((item) => ({ value: item.id, label: item.nome }))} /></Field>
            <Field label="Turma"><NativeSelect name="turmaId" placeholder="Opcional" options={(resources?.turmas ?? []).map((item) => ({ value: item.id, label: item.nome }))} /></Field>
            <Field label="Tamanho definido"><Input name="definedSize" className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Status"><NativeSelect name="status" defaultValue="PENDING" options={Object.entries(EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="Valor cobrado"><Input name="chargedValue" type="number" min={0} step="0.01" className={FILTER_INPUT_CLASS} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input name="isPaid" type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-violet-700" /> Pago?</label>
          <Field label="Observações"><Textarea name="notes" className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit">Salvar vínculo</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentActions({ assignment, eventId }: { assignment: CostumeAssignmentDTO; eventId: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status: EventCostumeAssignmentStatus) => updateCostumeAssignment(assignment.id, { status }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
    },
  });
  return (
    <div className="flex justify-end gap-2">
      {assignment.status === 'RECEIVED' ? <Button size="sm" variant="outline" className={SMALL_OUTLINE_BUTTON_CLASS} onClick={() => mutation.mutate('DELIVERED')}>Entregar</Button> : null}
      {assignment.status === 'DELIVERED' ? <Button size="sm" variant="outline" className={SMALL_OUTLINE_BUTTON_CLASS} onClick={() => mutation.mutate('RETURNED')}>Devolver</Button> : null}
    </div>
  );
}

function EventCostumesPanel({ eventId, resources }: { eventId: string; resources?: EventResources }) {
  const costumes = useQuery({ queryKey: eventQueryKeys.costumes(eventId), queryFn: () => listCostumes(eventId) });
  const assignments = useQuery({ queryKey: eventQueryKeys.assignments(eventId), queryFn: () => listCostumeAssignments(eventId) });
  const costumeRows = costumes.data ?? [];
  const assignmentRows = assignments.data ?? [];
  const cost = costumeRows.reduce((sum, item) => sum + (item.schoolCost ?? 0) * item.quantity, 0);
  const charged = assignmentRows.reduce((sum, item) => sum + (item.chargedValue ?? 0), 0);
  const delivered = assignmentRows.filter((item) => item.status === 'DELIVERED').length;
  const returned = assignmentRows.filter((item) => item.status === 'RETURNED').length;

  return (
    <Tabs defaultValue="costumes" variant="line" className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <TabsList className="overflow-x-auto"><TabsTrigger value="costumes">Figurinos</TabsTrigger><TabsTrigger value="assignments">Entregas</TabsTrigger><TabsTrigger value="metrics">Métricas</TabsTrigger></TabsList>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <CostumeFormDialog eventId={eventId} trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}><Plus className="h-4 w-4" /> Figurino</Button>} />
          <AssignmentFormDialog eventId={eventId} costumes={costumeRows} resources={resources} trigger={<Button className={PRIMARY_BUTTON_CLASS}><Plus className="h-4 w-4" /> Vínculo</Button>} />
        </div>
      </div>
      <TabsContent value="costumes">
        <TablePanel>
          <DataTable
            columns={[
              { id: 'name', header: 'Figurino', width: 'w-[26%]', align: 'left', render: (item: CostumeDTO) => <span className="font-medium text-slate-950">{item.name}</span> },
              { id: 'category', header: 'Categoria', width: 'w-[18%]', align: 'left', render: (item: CostumeDTO) => EVENT_COSTUME_CATEGORY_LABELS[item.category] },
              { id: 'size', header: 'Tamanho', width: 'w-[12%]', align: 'left', render: (item: CostumeDTO) => item.size || '-' },
              { id: 'cost', header: 'Custo', width: 'w-[16%]', align: 'right', render: (item: CostumeDTO) => formatCurrency((item.schoolCost ?? 0) * item.quantity) },
              { id: 'charge', header: 'Valor cobrado', width: 'w-[18%]', align: 'right', render: (item: CostumeDTO) => formatCurrency(item.chargedValue ?? 0) },
              { id: 'qty', header: 'Qtd.', width: 'w-[10%]', align: 'right', render: (item: CostumeDTO) => item.quantity },
            ]}
            data={costumeRows}
            rowKey={(item) => item.id}
            loading={costumes.isLoading}
            emptyMessage={<EmptyState title="Nenhum figurino cadastrado." description="Cadastre figurinos e acompanhe tamanhos, entregas, devoluções e custos." />}
          />
        </TablePanel>
      </TabsContent>
      <TabsContent value="assignments">
        <TablePanel>
          <DataTable
            columns={[
              { id: 'costume', header: 'Figurino', width: 'w-[22%]', align: 'left', render: (item: CostumeAssignmentDTO) => <span className="font-medium text-slate-950">{item.costume.name}</span> },
              { id: 'student', header: 'Aluno/Turma', width: 'w-[22%]', align: 'left', render: (item: CostumeAssignmentDTO) => item.aluno?.nome || item.turma?.nome || '-' },
              { id: 'status', header: 'Status', width: 'w-[15%]', align: 'center', render: (item: CostumeAssignmentDTO) => <SoftBadge>{EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS[item.status]}</SoftBadge> },
              { id: 'value', header: 'Valor', width: 'w-[14%]', align: 'right', render: (item: CostumeAssignmentDTO) => formatCurrency(item.chargedValue ?? 0) },
              { id: 'paid', header: 'Pago?', width: 'w-[13%]', align: 'center', render: (item: CostumeAssignmentDTO) => item.isPaid ? <SoftBadge tone="success">Pago</SoftBadge> : <SoftBadge tone="warning">Pendente</SoftBadge> },
              { id: 'actions', header: 'Ações', width: 'w-[14%]', align: 'right', render: (item: CostumeAssignmentDTO) => <AssignmentActions assignment={item} eventId={eventId} /> },
            ]}
            data={assignmentRows}
            rowKey={(item) => item.id}
            loading={assignments.isLoading}
            emptyMessage={<EmptyState title="Nenhuma entrega registrada." description="Vincule figurinos a alunos ou turmas para acompanhar entrega e devolução." />}
          />
        </TablePanel>
      </TabsContent>
      <TabsContent value="metrics">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Total de figurinos" value={costumeRows.length} icon={Shirt} />
          <MetricCard label="Entregues" value={delivered} icon={PackageCheck} tone="success" />
          <MetricCard label="Devolvidos" value={returned} icon={PackageCheck} />
          <MetricCard label="Custo total" value={formatCurrency(cost)} icon={WalletCards} tone="warning" />
          <MetricCard label="Valor cobrado" value={formatCurrency(charged)} icon={CircleDollarSign} tone="info" />
        </div>
      </TabsContent>
    </Tabs>
  );
}

function FinancialFormDialog({ eventId, type, trigger }: { eventId: string; type: EventFinancialEntryType; trigger: React.ReactNode }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: createFinancialEntry,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: type === 'COST' ? 'Custo lançado' : 'Receita lançada' });
    },
    onError: (error) => toast.error({ title: 'Erro no lançamento', description: (error as Error).message }),
  });
  function submit(formData: FormData) {
    mutation.mutate({
      eventId,
      type,
      category: nullableString(formData, 'category'),
      description: nullableString(formData, 'description'),
      supplier: nullableString(formData, 'supplier'),
      expectedAmount: numberValue(formData, 'expectedAmount') ?? 0,
      actualAmount: numberValue(formData, 'actualAmount'),
      dueDate: datetimeValue(formData, 'dueDate'),
      realizedAt: datetimeValue(formData, 'realizedAt'),
      status: nullableString(formData, 'status'),
      paymentMethod: nullableString(formData, 'paymentMethod'),
      notes: nullableString(formData, 'notes'),
    });
  }
  const categories = type === 'COST' ? EVENT_COST_CATEGORIES : EVENT_REVENUE_CATEGORIES;
  const statuses: EventFinancialEntryStatus[] = type === 'COST' ? ['EXPECTED', 'PENDING', 'PAID'] : ['EXPECTED', 'PENDING', 'RECEIVED'];
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{type === 'COST' ? 'Novo custo' : 'Nova receita'}</DialogTitle><DialogDescription>Separe valor previsto e realizado para manter o resultado confiável.</DialogDescription></DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Categoria"><NativeSelect name="category" required options={categories.map((category) => ({ value: category, label: category }))} /></Field>
            <Field label="Descrição"><Input name="description" required className={FILTER_INPUT_CLASS} /></Field>
            {type === 'COST' ? <Field label="Fornecedor"><Input name="supplier" className={FILTER_INPUT_CLASS} /></Field> : null}
            <Field label="Valor previsto"><Input name="expectedAmount" type="number" min={0} step="0.01" required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Valor realizado"><Input name="actualAmount" type="number" min={0} step="0.01" className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Data prevista"><DateTimeField name="dueDate" /></Field>
            <Field label={type === 'COST' ? 'Data de pagamento' : 'Data de recebimento'}><DateTimeField name="realizedAt" /></Field>
            <Field label="Status"><NativeSelect name="status" defaultValue={statuses[0]} options={statuses.map((status) => ({ value: status, label: EVENT_FINANCIAL_STATUS_LABELS[status] }))} /></Field>
            <Field label="Forma"><NativeSelect name="paymentMethod" placeholder="Opcional" options={EVENT_PAYMENT_METHODS.filter((method) => method !== 'COMPLIMENTARY').map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))} /></Field>
          </div>
          <Field label="Observações"><Textarea name="notes" className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit">Salvar lançamento</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FinanceActions({ entry, eventId }: { entry: FinancialEntryDTO; eventId: string }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status: EventFinancialEntryStatus) => updateFinancialEntry(entry.id, {
      status,
      actualAmount: entry.actualAmount ?? entry.expectedAmount,
      realizedAt: new Date().toISOString(),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
    },
    onError: (error) => toast.error({ title: 'Erro no lançamento', description: (error as Error).message }),
  });
  if (entry.originType !== 'MANUAL') return <SoftBadge tone="neutral">Automático</SoftBadge>;
  return (
    <div className="flex justify-end gap-2">
      {entry.type === 'COST' && entry.status !== 'PAID' ? <Button size="sm" variant="outline" className={SMALL_OUTLINE_BUTTON_CLASS} onClick={() => mutation.mutate('PAID')}>Pago</Button> : null}
      {entry.type === 'REVENUE' && entry.status !== 'RECEIVED' ? <Button size="sm" variant="outline" className={SMALL_OUTLINE_BUTTON_CLASS} onClick={() => mutation.mutate('RECEIVED')}>Recebido</Button> : null}
      {entry.status !== 'CANCELLED' ? <Button size="sm" variant="outline" className={SMALL_OUTLINE_BUTTON_CLASS} onClick={() => mutation.mutate('CANCELLED')}>Cancelar</Button> : null}
    </div>
  );
}

function EventFinancialPanel({ eventId, event }: { eventId: string; event?: SchoolEventDTO }) {
  const entries = useQuery({ queryKey: eventQueryKeys.finance(eventId), queryFn: () => listFinancialEntries(eventId) });
  const rows = entries.data ?? [];
  const costs = rows.filter((entry) => entry.type === 'COST');
  const revenues = rows.filter((entry) => entry.type === 'REVENUE');

  function renderTable(data: FinancialEntryDTO[]) {
    return (
      <TablePanel>
        <DataTable
          columns={[
            {
              id: 'desc',
              header: 'Descrição',
              width: 'w-[27%]',
              align: 'left',
              noWrap: false,
              cellClassName: 'min-w-0',
              render: (entry: FinancialEntryDTO) => (
                <span className="line-clamp-2 font-medium text-slate-950">{entry.description}</span>
              ),
            },
            { id: 'category', header: 'Categoria', width: 'w-[15%]', align: 'left', render: (entry: FinancialEntryDTO) => <span className="text-slate-700">{entry.category}</span> },
            { id: 'expected', header: 'Previsto', width: 'w-[13%]', align: 'right', render: (entry: FinancialEntryDTO) => formatCurrency(entry.expectedAmount) },
            { id: 'actual', header: 'Realizado', width: 'w-[13%]', align: 'right', render: (entry: FinancialEntryDTO) => formatCurrency(entry.actualAmount ?? 0) },
            { id: 'status', header: 'Status', width: 'w-[12%]', align: 'center', render: (entry: FinancialEntryDTO) => <SoftBadge>{EVENT_FINANCIAL_STATUS_LABELS[entry.status]}</SoftBadge> },
            { id: 'origin', header: 'Origem', width: 'w-[10%]', align: 'center', render: (entry: FinancialEntryDTO) => entry.originType === 'MANUAL' ? 'Manual' : 'Automática' },
            { id: 'actions', header: 'Ações', width: 'w-[10%]', align: 'right', render: (entry: FinancialEntryDTO) => <FinanceActions entry={entry} eventId={eventId} /> },
          ]}
          data={data}
          rowKey={(entry) => entry.id}
          loading={entries.isLoading}
          emptyMessage={<EmptyState title="Nenhum lançamento registrado." description="Lance custos e receitas para acompanhar o resultado do evento." />}
        />
      </TablePanel>
    );
  }

  return (
    <Tabs defaultValue="costs" variant="line" className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <TabsList className="overflow-x-auto"><TabsTrigger value="costs">Custos</TabsTrigger><TabsTrigger value="revenues">Receitas</TabsTrigger><TabsTrigger value="result">Resultado</TabsTrigger></TabsList>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <FinancialFormDialog eventId={eventId} type="COST" trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}><Plus className="h-4 w-4" /> Custo</Button>} />
          <FinancialFormDialog eventId={eventId} type="REVENUE" trigger={<Button className={PRIMARY_BUTTON_CLASS}><Plus className="h-4 w-4" /> Receita</Button>} />
        </div>
      </div>
      <TabsContent value="costs">{renderTable(costs)}</TabsContent>
      <TabsContent value="revenues">{renderTable(revenues)}</TabsContent>
      <TabsContent value="result">
        {event ? <EventSummary event={event} /> : null}
      </TabsContent>
    </Tabs>
  );
}

function EventReportsPanel({ eventId }: { eventId?: string }) {
  const reports = useQuery({ queryKey: eventQueryKeys.reports(eventId), queryFn: () => getEventReports({ eventId }) });
  const data = reports.data;
  return (
    <Tabs defaultValue="general" variant="line" className="space-y-5">
      <TabsList><TabsTrigger value="general">Geral</TabsTrigger><TabsTrigger value="event">Por evento</TabsTrigger><TabsTrigger value="compare">Comparativo</TabsTrigger></TabsList>
      <TabsContent value="general">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Receita total" value={formatCurrency(data?.general.receita ?? 0)} icon={CircleDollarSign} tone="success" />
          <MetricCard label="Custo total" value={formatCurrency(data?.general.custo ?? 0)} icon={WalletCards} tone="warning" />
          <MetricCard label="Lucro total" value={formatCurrency(data?.general.resultado ?? 0)} icon={BarChart3} tone={(data?.general.resultado ?? 0) >= 0 ? 'success' : 'danger'} />
          <MetricCard label="Ingressos vendidos" value={data?.general.ingressos ?? 0} icon={Ticket} />
        </div>
        <div className="mt-5">
          <DataTable
            columns={[
              { id: 'event', header: 'Evento', render: (event: SchoolEventDTO) => <Link href={`/events/${event.id}`} className="font-medium text-slate-950 hover:text-brand-accent">{event.name}</Link> },
              { id: 'revenue', header: 'Receita', align: 'right', render: (event: SchoolEventDTO) => formatCurrency(event.metrics.receitaRealizada) },
              { id: 'cost', header: 'Custo', align: 'right', render: (event: SchoolEventDTO) => formatCurrency(event.metrics.custoRealizado) },
              { id: 'result', header: 'Resultado', align: 'right', render: (event: SchoolEventDTO) => formatCurrency(event.metrics.resultadoRealizado) },
            ]}
            data={data?.general.ranking ?? []}
            rowKey={(event) => event.id}
            loading={reports.isLoading}
          />
        </div>
      </TabsContent>
      <TabsContent value="event">
        {data?.selected ? <EventSummary event={data.selected} /> : <EmptyState title="Nenhum evento selecionado." description="Selecione um evento para ver o relatório detalhado." />}
      </TabsContent>
      <TabsContent value="compare">
        <DataTable
          columns={[
            { id: 'name', header: 'Evento', render: (event: EventReportsDTO['events'][number]) => event.name },
            { id: 'type', header: 'Tipo', render: (event: EventReportsDTO['events'][number]) => EVENT_TYPE_LABELS[event.type] },
            { id: 'revenue', header: 'Receita', align: 'right', render: (event: EventReportsDTO['events'][number]) => formatCurrency(event.metrics.receitaRealizada) },
            { id: 'result', header: 'Resultado', align: 'right', render: (event: EventReportsDTO['events'][number]) => formatCurrency(event.metrics.resultadoRealizado) },
          ]}
          data={data?.events ?? []}
          rowKey={(event) => event.id}
          loading={reports.isLoading}
        />
      </TabsContent>
    </Tabs>
  );
}

function EventAuditPanel({ eventId }: { eventId: string }) {
  const audit = useQuery({ queryKey: eventQueryKeys.audit(eventId), queryFn: () => listEventAudit(eventId) });
  return (
    <div className="space-y-3">
      {(audit.data ?? []).map((item) => (
        <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-950">{item.action}</p>
            <span className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{item.entityType} · {item.actor?.nome || 'Sistema'}</p>
        </div>
      ))}
      {!audit.isLoading && !audit.data?.length ? <EmptyState title="Sem histórico ainda." description="Alterações operacionais e financeiras aparecerão aqui." /> : null}
    </div>
  );
}

export function EventDetailFeature({ eventId }: { eventId: string }) {
  const resources = useEventResources();
  const eventQuery = useQuery({ queryKey: eventQueryKeys.event(eventId), queryFn: () => getEvent(eventId) });
  const event = eventQuery.data;

  if (eventQuery.isLoading) {
    return <div className="h-80 animate-pulse rounded-xl bg-slate-100" />;
  }

  if (!event) {
    return <EmptyState title="Evento não encontrado." description="Verifique se o evento existe e pertence à conta atual." />;
  }

  return (
    <div className="space-y-5">
      <EventHeader event={event} />
      <Tabs defaultValue="summary" variant="line" className="space-y-5">
        <div className="border-b border-slate-100">
        <TabsList className="w-full overflow-x-auto">
          <TabsTrigger value="summary">Resumo</TabsTrigger>
          <TabsTrigger value="tickets">Ingressos</TabsTrigger>
          <TabsTrigger value="event-map">Mapa do evento</TabsTrigger>
          <TabsTrigger value="costumes">Figurinos</TabsTrigger>
          <TabsTrigger value="finance">Custos e receitas</TabsTrigger>
          <TabsTrigger value="reports">Relatórios</TabsTrigger>
          <TabsTrigger value="audit">Histórico</TabsTrigger>
        </TabsList>
        </div>
        <TabsContent value="summary"><EventSummary event={event} /></TabsContent>
        <TabsContent value="tickets"><EventTicketsPanel eventId={eventId} resources={resources.data} /></TabsContent>
        <TabsContent value="event-map"><EventMapPanel event={event} /></TabsContent>
        <TabsContent value="costumes"><EventCostumesPanel eventId={eventId} resources={resources.data} /></TabsContent>
        <TabsContent value="finance"><EventFinancialPanel eventId={eventId} event={event} /></TabsContent>
        <TabsContent value="reports"><EventReportsPanel eventId={eventId} /></TabsContent>
        <TabsContent value="audit"><EventAuditPanel eventId={eventId} /></TabsContent>
      </Tabs>
    </div>
  );
}

function EventSelector({ value, onChange, resources }: { value?: string; onChange: (value: string) => void; resources?: EventResources }) {
  const options = resources?.events ?? [];
  return (
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)} className={cn(SELECT_CLASS, 'min-w-72')}>
      <option value="">Selecione um evento</option>
      {options.map((event) => (
        <option key={event.id} value={event.id}>{event.name} · {formatDate(event.startsAt)}</option>
      ))}
    </select>
  );
}

export function EventOperationsFeature({ section }: { section: 'tickets' | 'costumes' | 'financial' | 'reports' }) {
  const resources = useEventResources();
  const firstEventId = resources.data?.events[0]?.id;
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const selectedEventId = eventId || firstEventId;
  const event = useQuery({
    queryKey: selectedEventId ? eventQueryKeys.event(selectedEventId) : ['events', 'none'],
    queryFn: () => getEvent(selectedEventId!),
    enabled: Boolean(selectedEventId),
  });

  const title = {
    tickets: 'Ingressos',
    costumes: 'Figurinos',
    financial: 'Custos e receitas',
    reports: 'Relatórios',
  }[section];

  return (
    <TableLayout
      title={title}
      subtitle="Tudo nesta página permanece vinculado ao evento selecionado."
      filtersBar={<div className="flex justify-end"><EventSelector value={selectedEventId} onChange={setEventId} resources={resources.data} /></div>}
      className="pr-4 xl:pr-6"
    >
      {!selectedEventId ? (
        <EmptyState title="Nenhum evento criado ainda." description="Crie um evento antes de configurar ingressos, figurinos ou financeiro." />
      ) : section === 'tickets' ? (
        <EventTicketsPanel eventId={selectedEventId} resources={resources.data} />
      ) : section === 'costumes' ? (
        <EventCostumesPanel eventId={selectedEventId} resources={resources.data} />
      ) : section === 'financial' ? (
        <EventFinancialPanel eventId={selectedEventId} event={event.data} />
      ) : (
        <EventReportsPanel eventId={selectedEventId} />
      )}
    </TableLayout>
  );
}
