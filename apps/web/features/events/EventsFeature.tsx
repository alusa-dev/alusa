'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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
  MapPin,
  Tag,
  Trash2,
  User,
  Clock,
  Eye,
  MoreVertical,
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
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
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
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { AutocompleteList } from '@/components/matriculas/wizard/shared/AutocompleteList';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

import {
  cancelTicketSale,
  createCostume,
  createCostumeAssignment,
  createFinancialEntry,
  createTicketLot,
  createTicketSale,
  deleteCostume,
  deleteCostumeAssignment,
  type EventListResult,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatTime,
  getEvent,
  getEventReports,
  listCostumeAssignments,
  listCostumes,
  listEventAudit,
  updateCostume,

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
  deleteTicketLot,
  updateTicketSale,
  deleteTicketSale,
  listEventParticipants,
  registerEventParticipant,
  unregisterEventParticipant,
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
function getRoundedNowISOString() {
  const now = new Date();
  const minutes = now.getMinutes();
  const rounded = Math.round(minutes / 15) * 15;
  if (rounded === 60) {
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
  } else {
    now.setMinutes(rounded);
  }
  now.setSeconds(0);
  now.setMilliseconds(0);
  return now.toISOString();
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
  onValueChange,
}: {
  name: string;
  defaultValue?: string | null;
  options: Option[];
  required?: boolean;
  placeholder?: string;
  onValueChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue ?? '');
  return (
    <>
      <input type="hidden" name={name} value={value} required={required} />
      <Select
        value={value || undefined}
        onValueChange={(next) => {
          const val = next === EMPTY_SELECT_VALUE ? '' : next;
          setValue(val);
          onValueChange?.(val);
        }}
      >
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
    neutral: 'bg-slate-100 text-slate-600',
    success: 'bg-emerald-100 text-emerald-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-rose-100 text-rose-800',
    info: 'bg-violet-100 text-violet-800',
  }[tone];
  return <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}>{children}</span>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-6 py-10 text-center">
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
  const [regFeeText, setRegFeeText] = useState("");
  const resources = useEventResources();

  useEffect(() => {
    if (open) {
      const fee = event?.registrationFee ?? 0;
      setRegFeeText(fee > 0 ? fee.toFixed(2).replace('.', ',') : "");
    }
  }, [open, event]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => saveEvent(payload, event?.id),
    onSuccess: async (saved) => {
      toast.success({
        title: event ? 'Evento updated' : 'Evento criado',
        description: event ? 'As alterações do evento foram salvas com sucesso.' : 'O novo evento foi cadastrado com sucesso.'
      });
      await queryClient.invalidateQueries({ queryKey: eventQueryKeys.events });
      if (event?.id) await queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(event.id) });
      setOpen(false);
      onSaved?.(saved);
    },
    onError: (error) => toast.error({ title: 'Erro ao salvar evento', description: (error as Error).message }),
  });

  function handleSubmit(formData: FormData) {
    const regFeeRaw = nullableString(formData, 'registrationFee') ?? '';
    const registrationFee = regFeeRaw ? parseCurrencyInput(regFeeRaw) : undefined;

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
      registrationFee,
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
              <div className="mt-4">
                <div className="grid gap-4 md:grid-cols-2">
                <Field label="Tipo de ingresso">
                  <NativeSelect
                    name="ticketMode"
                    defaultValue={event?.ticketMode ?? (event?.hasTickets ? 'SIMPLE' : 'NONE')}
                    options={EVENT_TICKET_MODES.map((mode) => ({ value: mode, label: EVENT_TICKET_MODE_LABELS[mode] }))}
                  />
                </Field>
                <Field label="Taxa de inscrição sugerida">
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                      R$
                    </span>
                    <Input
                      name="registrationFee"
                      type="text"
                      value={regFeeText}
                      onChange={(e) => setRegFeeText(formatCurrencyInput(e.target.value))}
                      className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                    />
                  </div>
                </Field>
              </div>
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
      title="Todos os Eventos"
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
        {query.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="animate-pulse h-48 bg-slate-50 border border-slate-100 rounded-xl" />
            ))}
          </div>
        ) : events.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {events.map((event) => (
              <Card
                key={event.id}
                className="cursor-pointer transition-shadow hover:shadow-md rounded-xl border border-slate-200"
                onClick={() => router.push(`/events/${event.id}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-lg font-semibold text-slate-800 line-clamp-1" title={event.name}>
                      {event.name}
                    </CardTitle>
                    <StatusBadge status={event.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                      <span className="truncate">{event.locationName || 'Local não definido'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-slate-400 shrink-0" />
                      <span>{formatDate(event.startsAt)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-slate-400 shrink-0" />
                      <span>{EVENT_TYPE_LABELS[event.type]}</span>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-3 grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <span className="block text-slate-500">Ingressos</span>
                      <strong className="block text-slate-900 font-semibold">{event.metrics.ingressosVendidos}</strong>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <span className="block text-slate-500">Receita</span>
                      <strong className="block text-slate-900 font-semibold">{formatCurrency(event.metrics.receitaRealizada)}</strong>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200">
            <p className="text-slate-500">Nenhum evento encontrado.</p>
          </div>
        )}
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
      toast.success({ title: 'Status atualizado', description: 'O status do evento foi atualizado com sucesso.' });
    },
    onError: (error) => toast.error({ title: 'Erro ao alterar status', description: (error as Error).message }),
  });

  const nextActions: Array<{ status: SchoolEventStatus; label: string; icon: typeof CheckCircle2 }> = [
    ...(event.status === 'PLANNING' ? [{ status: 'ACTIVE' as const, label: 'Ativar', icon: CheckCircle2 }] : []),
    ...(event.status === 'ACTIVE' ? [{ status: 'FINISHED' as const, label: 'Finalizar Evento', icon: CheckCircle2 }] : []),
    ...(event.status === 'FINISHED' ? [
      { status: 'ACTIVE' as const, label: 'Reativar Evento', icon: CheckCircle2 },
      { status: 'ARCHIVED' as const, label: 'Arquivar', icon: PackageCheck }
    ] : []),
    ...(event.status === 'ARCHIVED' ? [{ status: 'FINISHED' as const, label: 'Desarquivar', icon: PackageCheck }] : []),
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm shadow-slate-200/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold tracking-tight text-slate-950 md:text-2xl">{event.name}</h1>
            <StatusBadge status={event.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
              <span>{event.locationName || 'Local não definido'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 text-slate-400 shrink-0" />
              <span>{formatDate(event.startsAt)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-slate-400 shrink-0" />
              <span>{formatTime(event.startsAt)}</span>
            </div>
            {event.responsibleUser?.nome && (
              <div className="flex items-center gap-1.5">
                <User className="h-4 w-4 text-slate-400 shrink-0" />
                <span>{event.responsibleUser.nome}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <EventFormDialog event={event} trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}>Editar</Button>} />
          {nextActions.map((action) => {
            if (action.status === 'FINISHED') {
              return (
                <Dialog key={action.status}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className={OUTLINE_BUTTON_CLASS}>
                      <action.icon className="h-4 w-4" />
                      {action.label}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Finalizar Evento - Detalhes e Insights</DialogTitle>
                      <DialogDescription>
                        Confira o resumo financeiro e métricas operacionais obtidas no evento <strong>{event.name}</strong> antes de finalizá-lo.
                      </DialogDescription>
                    </DialogHeader>
                    
                    <div className="py-4 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                          <span className="block text-xs text-slate-500 font-medium">Receita Recebida</span>
                          <strong className="block text-lg font-bold text-emerald-600 mt-1">
                            {formatCurrency(event.metrics.receitaRealizada)}
                          </strong>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                          <span className="block text-xs text-slate-500 font-medium">Custos Pagos</span>
                          <strong className="block text-lg font-bold text-amber-600 mt-1">
                            {formatCurrency(event.metrics.custoRealizado || 0)}
                          </strong>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                          <span className="block text-xs text-slate-500 font-medium">Resultado Líquido</span>
                          <strong className={cn(
                            "block text-lg font-bold mt-1",
                            event.metrics.resultadoRealizado >= 0 ? "text-emerald-600" : "text-rose-600"
                          )}>
                            {formatCurrency(event.metrics.resultadoRealizado)}
                          </strong>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                          <span className="block text-xs text-slate-500 font-medium">Ingressos Vendidos</span>
                          <strong className="block text-lg font-bold text-slate-900 mt-1">
                            {event.metrics.ingressosVendidos}
                          </strong>
                        </div>
                      </div>
                      
                      {event.metrics.figurinosPendentes > 0 && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-amber-800 text-xs flex items-center gap-2">
                          <span className="font-semibold">Atenção:</span> Ainda constam {event.metrics.figurinosPendentes} figurinos pendentes de entrega/retorno.
                        </div>
                      )}
                    </div>

                    <DialogFooter className="flex sm:justify-between gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => window.print()}
                      >
                        Imprimir relatório
                      </Button>
                      <DialogClose asChild>
                        <Button
                          type="button"
                          className={PRIMARY_BUTTON_CLASS}
                          onClick={() => statusMutation.mutate('FINISHED')}
                          disabled={statusMutation.isPending}
                        >
                          {statusMutation.isPending ? 'Finalizando...' : 'Sair'}
                        </Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              );
            }

            return (
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
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EventSummary({ event }: { event: SchoolEventDTO }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard label="Receita prevista" value={formatCurrency(event.metrics.receitaPrevista)} icon={CircleDollarSign} tone="info" />
        <MetricCard label="Receita recebida" value={formatCurrency(event.metrics.receitaRealizada)} icon={CircleDollarSign} tone="success" />
        <MetricCard label="Custos previstos" value={formatCurrency(event.metrics.custoPrevisto)} icon={WalletCards} tone="warning" />
        <MetricCard label="Resultado realizado" value={formatCurrency(event.metrics.resultadoRealizado)} icon={BarChart3} tone={event.metrics.resultadoRealizado >= 0 ? 'success' : 'danger'} />
        <MetricCard label="Lucro estimado" value={formatCurrency(event.metrics.resultadoPrevisto)} icon={BarChart3} tone={event.metrics.resultadoPrevisto >= 0 ? 'success' : 'danger'} />
        <MetricCard label="Ingressos vendidos" value={event.metrics.ingressosVendidos} icon={Ticket} />
        <MetricCard label="Figurinos pendentes" value={event.metrics.figurinosPendentes} icon={Shirt} tone="warning" />
        <MetricCard label="Ticket médio" value={event.metrics.ticketMedio == null ? '-' : formatCurrency(event.metrics.ticketMedio)} icon={Ticket} />
        <MetricCard label="Taxa de ocupação" value={event.metrics.taxaOcupacao == null ? '-' : `${Math.round(event.metrics.taxaOcupacao * 100)}%`} icon={BarChart3} />
      </div>
    </div>
  );
}

function LotFormDialog({
  eventId,
  trigger,
  lot,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  eventId: string;
  trigger?: React.ReactNode;
  lot?: TicketLotDTO;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : localOpen;
  const setOpen = controlledOnOpenChange !== undefined ? controlledOnOpenChange : setLocalOpen;
  const [priceText, setPriceText] = useState("");

  useEffect(() => {
    if (open) {
      const price = lot?.unitPrice ?? 0;
      setPriceText(price > 0 ? price.toFixed(2).replace('.', ',') : "0,00");
    }
  }, [open, lot]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => (lot ? updateTicketLot(lot.id, payload) : createTicketLot(payload)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({
        title: lot ? 'Lote atualizado' : 'Lote criado',
        description: lot ? 'As alterações do lote foram salvas com sucesso.' : 'O novo lote de ingressos foi criado com sucesso.'
      });
      setOpen(false);
    },
    onError: (error) => toast.error({ title: 'Erro no lote', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    const unitPriceRaw = nullableString(formData, 'unitPrice') ?? '';
    const unitPrice = parseCurrencyInput(unitPriceRaw);

    mutation.mutate({
      eventId,
      name: nullableString(formData, 'name'),
      ticketType: nullableString(formData, 'ticketType'),
      unitPrice,
      quantityTotal: numberValue(formData, 'quantityTotal'),
      saleStartsAt: datetimeValue(formData, 'saleStartsAt'),
      saleEndsAt: datetimeValue(formData, 'saleEndsAt'),
      status: nullableString(formData, 'status') ?? 'DRAFT',
      notes: nullableString(formData, 'notes'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lot ? 'Editar lote' : 'Novo lote'}</DialogTitle>
          <DialogDescription>Configure estoque, valor e período de vendas.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome do lote"><Input name="name" defaultValue={lot?.name ?? ''} required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Tipo"><NativeSelect name="ticketType" defaultValue={lot?.ticketType ?? 'FULL'} options={EVENT_TICKET_TYPES.map((type) => ({ value: type, label: EVENT_TICKET_TYPE_LABELS[type] }))} required /></Field>
            <Field label="Valor unitário">
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                  R$
                </span>
                <Input
                  name="unitPrice"
                  type="text"
                  value={priceText}
                  onChange={(e) => setPriceText(formatCurrencyInput(e.target.value))}
                  className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                  required
                />
              </div>
            </Field>
            <Field label="Quantidade"><Input name="quantityTotal" type="number" min={1} defaultValue={lot?.quantityTotal ?? 1} required className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Início das vendas"><DateTimeField name="saleStartsAt" defaultValue={lot?.saleStartsAt ?? getRoundedNowISOString()} /></Field>
            <Field label="Fim das Vendas (opcional)"><DateTimeField name="saleEndsAt" defaultValue={lot?.saleEndsAt} /></Field>
            <Field label="Status"><NativeSelect name="status" defaultValue={lot?.status ?? 'DRAFT'} options={Object.entries(EVENT_TICKET_LOT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
          </div>
          <Field label="Observações"><Textarea name="notes" defaultValue={lot?.notes ?? ''} className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>Salvar lote</Button></DialogFooter>
        </form>
      </DialogContent>

    </Dialog>
  );
}

function LotActions({ lot, eventId }: { lot: TicketLotDTO; eventId: string }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
    ]);
  };

  const remove = useMutation({
    mutationFn: () => deleteTicketLot(lot.id),
    onSuccess: async () => {
      await invalidate();
      toast.success({ title: 'Lote excluído', description: 'O lote de ingressos foi removido com sucesso.' });
      setDeleteOpen(false);
    },
    onError: (err) => toast.error({ title: 'Erro ao excluir lote', description: err.message }),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Editar
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50"
            disabled={lot.quantitySold > 0}
            onClick={() => setDeleteOpen(true)}
            title={lot.quantitySold > 0 ? 'Não é possível excluir um lote com ingressos já vendidos.' : undefined}
          >
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LotFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        eventId={eventId}
        lot={lot}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir lote de ingressos"
        description={`Tem certeza que deseja excluir permanentemente o lote "${lot.name}"?\n\nEsta ação removerá o lote do evento e não poderá ser desfeita.`}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
      />
    </>
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
      toast.success({ title: 'Venda registrada', description: 'A venda de ingressos foi registrada com sucesso.' });
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
            <Field label="Data da venda"><DateTimeField name="soldAt" defaultValue={getRoundedNowISOString()} /></Field>
          </div>
          <Field label="Observações"><Textarea name="notes" className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>Registrar venda</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditSaleFormDialog({
  open,
  onOpenChange,
  eventId,
  sale,
  lots,
  resources,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  sale: TicketSaleDTO;
  lots: TicketLotDTO[];
  resources?: EventResources;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: Record<string, any>) => updateTicketSale(sale.id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.sales(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Venda atualizada', description: 'A venda de ingressos foi atualizada com sucesso.' });
      onOpenChange(false);
    },
    onError: (error) => toast.error({ title: 'Erro ao atualizar venda', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    mutation.mutate({
      lotId: nullableString(formData, 'lotId'),
      buyerName: nullableString(formData, 'buyerName'),
      alunoId: nullableString(formData, 'alunoId') || null,
      responsavelId: nullableString(formData, 'responsavelId') || null,
      quantity: numberValue(formData, 'quantity') ?? 1,
      paymentMethod: nullableString(formData, 'paymentMethod'),
      status: nullableString(formData, 'status'),
      soldAt: datetimeValue(formData, 'soldAt'),
      notes: nullableString(formData, 'notes') || null,
    });
  }

  const lotOptions = lots
    .filter((lot) => lot.status === 'ACTIVE' || lot.id === sale.lotId)
    .map((lot) => ({
      value: lot.id,
      label: `${lot.name} · ${formatCurrency(lot.unitPrice)} · ${lot.quantityAvailable + (lot.id === sale.lotId ? sale.quantity : 0)} disp.`,
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar venda de ingresso</DialogTitle>
          <DialogDescription>Altere as informações da venda. O estoque e o lançamento financeiro associados serão atualizados.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Lote">
              <NativeSelect
                name="lotId"
                required
                defaultValue={sale.lotId}
                options={lotOptions}
              />
            </Field>
            <Field label="Comprador">
              <Input
                name="buyerName"
                required
                defaultValue={sale.buyerName}
                className={FILTER_INPUT_CLASS}
              />
            </Field>
            <Field label="Aluno vinculado">
              <NativeSelect
                name="alunoId"
                placeholder="Opcional"
                defaultValue={sale.aluno?.id ?? ''}
                options={(resources?.alunos ?? []).map((item) => ({ value: item.id, label: item.nome }))}
              />
            </Field>
            <Field label="Responsável vinculado">
              <NativeSelect
                name="responsavelId"
                placeholder="Opcional"
                defaultValue={sale.responsavel?.id ?? ''}
                options={(resources?.responsaveis ?? []).map((item) => ({ value: item.id, label: item.nome }))}
              />
            </Field>
            <Field label="Quantidade">
              <Input
                name="quantity"
                type="number"
                min={1}
                defaultValue={sale.quantity}
                required
                className={FILTER_INPUT_CLASS}
              />
            </Field>
            <Field label="Forma de pagamento">
              <NativeSelect
                name="paymentMethod"
                defaultValue={sale.paymentMethod}
                options={EVENT_PAYMENT_METHODS.map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))}
              />
            </Field>
            <Field label="Status">
              <NativeSelect
                name="status"
                defaultValue={sale.status}
                options={Object.entries(EVENT_TICKET_SALE_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Data da venda">
              <DateTimeField name="soldAt" defaultValue={sale.soldAt} />
            </Field>
          </div>
          <Field label="Observações">
            <Textarea
              name="notes"
              defaultValue={sale.notes ?? ''}
              className="rounded-xl border-slate-200"
            />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TicketActions({ sale, eventId, lots, resources }: { sale: TicketSaleDTO; eventId: string; lots: TicketLotDTO[]; resources?: EventResources }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.sales(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.lots(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
    ]);
  };

  const paid = useMutation({ mutationFn: () => markTicketSalePaid(sale.id), onSuccess: invalidate, onError: (err) => toast.error({ title: 'Erro ao marcar como pago', description: err.message }) });
  const cancel = useMutation({ mutationFn: () => cancelTicketSale(sale.id), onSuccess: invalidate, onError: (err) => toast.error({ title: 'Erro ao cancelar', description: err.message }) });
  const refund = useMutation({ mutationFn: () => refundTicketSale(sale.id), onSuccess: invalidate, onError: (err) => toast.error({ title: 'Erro ao estornar', description: err.message }) });
  const remove = useMutation({
    mutationFn: () => deleteTicketSale(sale.id),
    onSuccess: async () => {
      await invalidate();
      toast.success({ title: 'Venda excluída', description: 'A venda de ingresso foi excluída com sucesso.' });
      setDeleteOpen(false);
    },
    onError: (err) => toast.error({ title: 'Erro ao excluir', description: err.message }),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Editar
          </DropdownMenuItem>

          {sale.status === 'PENDING' && (
            <DropdownMenuItem onClick={() => paid.mutate()}>
              Marcar como Pago
            </DropdownMenuItem>
          )}

          {(sale.status === 'PENDING' || sale.status === 'COMPLIMENTARY') && (
            <DropdownMenuItem onClick={() => cancel.mutate()}>
              Cancelar Venda
            </DropdownMenuItem>
          )}

          {sale.status === 'PAID' && (
            <DropdownMenuItem onClick={() => refund.mutate()}>
              Estornar
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50"
            disabled={sale.status === 'PAID'}
            onClick={() => setDeleteOpen(true)}
            title={sale.status === 'PAID' ? 'Não é possível excluir uma venda paga.' : undefined}
          >
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditSaleFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        eventId={eventId}
        sale={sale}
        lots={lots}
        resources={resources}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir venda de ingresso"
        description={`Tem certeza que deseja excluir permanentemente a venda de ${sale.buyerName} (${sale.quantity}x ${sale.lot.name})?\n\nEsta ação removerá o registro de venda do sistema e atualizará o estoque do lote.`}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
      />
    </>
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
    <Tabs defaultValue="sales" variant="line" className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <TabsList className="overflow-x-auto">
          <TabsTrigger value="sales">Vendas</TabsTrigger>
          <TabsTrigger value="lots">Lotes</TabsTrigger>
          <TabsTrigger value="metrics">Métricas</TabsTrigger>
        </TabsList>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <LotFormDialog eventId={eventId} trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}><Plus className="h-4 w-4" /> Lote</Button>} />
          <SaleFormDialog eventId={eventId} lots={lotRows} resources={resources} trigger={<Button className={PRIMARY_BUTTON_CLASS}><Plus className="h-4 w-4" /> Venda</Button>} />
        </div>
      </div>
      <TabsContent value="sales">
        <TablePanel>
          <DataTable
            paginate={true}
            pageSize={5}
            columns={[
              { id: 'buyer', header: 'Comprador', width: 'w-[22%]', align: 'left', render: (sale: TicketSaleDTO) => <span className="font-medium text-slate-950">{sale.buyerName}</span> },
              { id: 'lot', header: 'Lote', width: 'w-[16%]', align: 'left', render: (sale: TicketSaleDTO) => sale.lot.name },
              { id: 'qty', header: 'Qtd.', width: 'w-[9%]', align: 'right', render: (sale: TicketSaleDTO) => sale.quantity },
              { id: 'total', header: 'Total', width: 'w-[14%]', align: 'right', render: (sale: TicketSaleDTO) => formatCurrency(sale.totalAmount) },
              { id: 'status', header: 'Status', width: 'w-[14%]', align: 'center', render: (sale: TicketSaleDTO) => {
                const tone = {
                  PENDING: 'warning',
                  PAID: 'success',
                  CANCELLED: 'danger',
                  REFUNDED: 'neutral',
                  COMPLIMENTARY: 'info',
                }[sale.status] as any;
                return <SoftBadge tone={tone}>{EVENT_TICKET_SALE_STATUS_LABELS[sale.status]}</SoftBadge>;
              } },
              { id: 'date', header: 'Data', width: 'w-[13%]', align: 'left', render: (sale: TicketSaleDTO) => formatDate(sale.soldAt) },
              { id: 'actions', header: 'Ações', width: 'w-[12%]', align: 'right', render: (sale: TicketSaleDTO) => <TicketActions sale={sale} eventId={eventId} lots={lotRows} resources={resources} /> },
            ]}
            data={saleRows}
            rowKey={(sale) => sale.id}
            loading={sales.isLoading}
            emptyMessage={<EmptyState title="Nenhuma venda registrada." description="Registre vendas manuais vinculadas a um lote deste evento." />}
          />
        </TablePanel>
      </TabsContent>
      <TabsContent value="lots">
        <TablePanel>
          <DataTable
            paginate={true}
            pageSize={5}
            columns={[
              { id: 'name', header: 'Lote', width: 'w-[24%]', align: 'left', render: (lot: TicketLotDTO) => <span className="font-medium text-slate-950">{lot.name}</span> },
              { id: 'type', header: 'Tipo', width: 'w-[16%]', align: 'left', render: (lot: TicketLotDTO) => EVENT_TICKET_TYPE_LABELS[lot.ticketType] },
              { id: 'price', header: 'Valor', width: 'w-[15%]', align: 'right', render: (lot: TicketLotDTO) => formatCurrency(lot.unitPrice) },
              { id: 'stock', header: 'Vendido/Total', width: 'w-[18%]', align: 'right', render: (lot: TicketLotDTO) => `${lot.quantitySold}/${lot.quantityTotal}` },
              { id: 'status', header: 'Status', width: 'w-[15%]', align: 'center', render: (lot: TicketLotDTO) => {
                const tone = {
                  DRAFT: 'neutral',
                  ACTIVE: 'success',
                  SOLD_OUT: 'warning',
                  CLOSED: 'neutral',
                  CANCELLED: 'danger',
                  ARCHIVED: 'neutral',
                }[lot.status] as any;
                return <SoftBadge tone={tone}>{EVENT_TICKET_LOT_STATUS_LABELS[lot.status]}</SoftBadge>;
              } },
              { id: 'actions', header: 'Ações', width: 'w-[12%]', align: 'right', render: (lot: TicketLotDTO) => <LotActions lot={lot} eventId={eventId} /> },
            ]}
            data={lotRows}
            rowKey={(lot) => lot.id}
            loading={lots.isLoading}
            emptyMessage={<EmptyState title="Nenhum lote criado." description="Crie um lote para começar a registrar vendas de ingressos deste evento." />}
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

function CostumeFormDialog({
  eventId,
  trigger,
  costume,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  eventId: string;
  trigger?: React.ReactNode;
  costume?: CostumeDTO;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : localOpen;
  const setOpen = controlledOnOpenChange !== undefined ? controlledOnOpenChange : setLocalOpen;
  const [schoolCostText, setSchoolCostText] = useState("");
  const [chargedValueText, setChargedValueText] = useState("");

  useEffect(() => {
    if (open) {
      const cost = costume?.schoolCost ?? 0;
      setSchoolCostText(cost > 0 ? cost.toFixed(2).replace('.', ',') : "");
      const charge = costume?.chargedValue ?? 0;
      setChargedValueText(charge > 0 ? charge.toFixed(2).replace('.', ',') : "");
    } else {
      setSchoolCostText("");
      setChargedValueText("");
    }
  }, [open, costume]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      costume ? updateCostume(costume.id, payload) : createCostume(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.costumes(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({
        title: costume ? 'Figurino atualizado' : 'Figurino cadastrado',
        description: costume ? 'O figurino foi atualizado com sucesso.' : 'O figurino foi cadastrado com sucesso.'
      });
      setOpen(false);
    },
    onError: (error) => toast.error({ title: 'Erro no figurino', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    const schoolCostRaw = nullableString(formData, 'schoolCost') ?? '';
    const chargedValueRaw = nullableString(formData, 'chargedValue') ?? '';

    mutation.mutate({
      eventId,
      name: nullableString(formData, 'name'),
      category: nullableString(formData, 'category'),
      size: nullableString(formData, 'size'),
      color: nullableString(formData, 'color'),
      accessories: nullableString(formData, 'accessories'),
      schoolCost: schoolCostRaw ? parseCurrencyInput(schoolCostRaw) : null,
      chargedValue: chargedValueRaw ? parseCurrencyInput(chargedValueRaw) : null,
      supplier: nullableString(formData, 'supplier'),
      quantity: numberValue(formData, 'quantity') ?? 1,
      description: nullableString(formData, 'description'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{costume ? 'Editar figurino' : 'Novo figurino'}</DialogTitle>
          <DialogDescription>Cadastre peças, custos e valores cobrados.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome"><Input name="name" required defaultValue={costume?.name} className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Categoria"><NativeSelect name="category" defaultValue={costume?.category ?? "CLOTHING"} options={EVENT_COSTUME_CATEGORIES.map((category) => ({ value: category, label: EVENT_COSTUME_CATEGORY_LABELS[category] }))} /></Field>
            <Field label="Tamanho"><Input name="size" defaultValue={costume?.size ?? ''} className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Cor"><Input name="color" defaultValue={costume?.color ?? ''} className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Custo escola">
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                  R$
                </span>
                <Input
                  name="schoolCost"
                  type="text"
                  value={schoolCostText}
                  onChange={(e) => setSchoolCostText(formatCurrencyInput(e.target.value))}
                  className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                />
              </div>
            </Field>
            <Field label="Valor cobrado (opcional)">
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                  R$
                </span>
                <Input
                  name="chargedValue"
                  type="text"
                  value={chargedValueText}
                  onChange={(e) => setChargedValueText(formatCurrencyInput(e.target.value))}
                  className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                />
              </div>
            </Field>
            <Field label="Quantidade"><Input name="quantity" type="number" min={1} defaultValue={costume?.quantity ?? 1} className={FILTER_INPUT_CLASS} /></Field>
            <Field label="Fornecedor"><Input name="supplier" defaultValue={costume?.supplier ?? ''} className={FILTER_INPUT_CLASS} /></Field>
          </div>
          <Field label="Acessórios inclusos"><Input name="accessories" defaultValue={costume?.accessories ?? ''} className={FILTER_INPUT_CLASS} /></Field>
          <Field label="Descrição"><Textarea name="description" defaultValue={costume?.description ?? ''} className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit" disabled={mutation.isPending}>Salvar figurino</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CostumeActions({ costume, eventId }: { costume: CostumeDTO; eventId: string }) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.costumes(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
    ]);
  };

  const remove = useMutation({
    mutationFn: () => deleteCostume(costume.id),
    onSuccess: async () => {
      await invalidate();
      toast.success({ title: 'Figurino excluído', description: 'O figurino foi removido com sucesso.' });
      setDeleteOpen(false);
    },
    onError: (err) => toast.error({ title: 'Erro ao excluir figurino', description: err.message }),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Editar
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50"
            disabled={costume.assignmentsCount > 0}
            onClick={() => setDeleteOpen(true)}
            title={costume.assignmentsCount > 0 ? 'Não é possível excluir um figurino com alunos vinculados.' : undefined}
          >
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CostumeFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        eventId={eventId}
        costume={costume}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir figurino"
        description={`Tem certeza que deseja excluir permanentemente o figurino "${costume.name}"?\n\nEsta ação removerá o figurino do evento e não poderá ser desfeita.`}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
      />
    </>
  );
}

function AssignmentFormDialog({ eventId, costumes, resources, trigger }: { eventId: string; costumes: CostumeDTO[]; resources?: EventResources; trigger: React.ReactNode }) {

  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [chargedValueText, setChargedValueText] = useState("");

  const mutation = useMutation({
    mutationFn: createCostumeAssignment,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Entrega cadastrada', description: 'A entrega do figurino foi registrada com sucesso.' });
      setOpen(false);
      setChargedValueText("");
    },
    onError: (error) => toast.error({ title: 'Erro na entrega', description: (error as Error).message }),
  });
  function submit(formData: FormData) {
    const chargedValueRaw = nullableString(formData, 'chargedValue') ?? '';

    mutation.mutate({
      eventId,
      costumeId: nullableString(formData, 'costumeId'),
      alunoId: nullableString(formData, 'alunoId'),
      turmaId: nullableString(formData, 'turmaId'),
      definedSize: nullableString(formData, 'definedSize'),
      status: nullableString(formData, 'status'),
      chargedValue: chargedValueRaw ? parseCurrencyInput(chargedValueRaw) : undefined,
      isPaid: booleanValue(formData, 'isPaid'),
      notes: nullableString(formData, 'notes'),
    });
  }
  return (
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val);
      if (!val) {
        setChargedValueText("");
      }
    }}>
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
            <Field label="Valor cobrado">
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                  R$
                </span>
                <Input
                  name="chargedValue"
                  type="text"
                  value={chargedValueText}
                  onChange={(e) => setChargedValueText(formatCurrencyInput(e.target.value))}
                  className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                />
              </div>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input name="isPaid" type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-violet-700" /> Pago?</label>
          <Field label="Observações"><Textarea name="notes" className="rounded-xl border-slate-200" /></Field>
          <DialogFooter><Button type="submit">Salvar vínculo</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditAssignmentFormDialog({
  eventId,
  assignment,
  costumes,
  resources,
  open,
  onOpenChange,
}: {
  eventId: string;
  assignment: CostumeAssignmentDTO;
  costumes: CostumeDTO[];
  resources?: EventResources;
  open: boolean;
  onOpenChange: (val: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [chargedValueText, setChargedValueText] = useState(
    assignment.chargedValue ? (assignment.chargedValue).toFixed(2).replace('.', ',') : ""
  );

  useEffect(() => {
    if (open) {
      setChargedValueText(assignment.chargedValue ? (assignment.chargedValue).toFixed(2).replace('.', ',') : "");
    }
  }, [open, assignment.chargedValue]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => updateCostumeAssignment(assignment.id, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Vínculo atualizado', description: 'O vínculo do figurino foi atualizado com sucesso.' });
      onOpenChange(false);
    },
    onError: (error) => toast.error({ title: 'Erro ao atualizar', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    const chargedValueRaw = nullableString(formData, 'chargedValue') ?? '';

    mutation.mutate({
      costumeId: nullableString(formData, 'costumeId'),
      alunoId: nullableString(formData, 'alunoId') || null,
      turmaId: nullableString(formData, 'turmaId') || null,
      definedSize: nullableString(formData, 'definedSize'),
      status: nullableString(formData, 'status'),
      chargedValue: chargedValueRaw ? parseCurrencyInput(chargedValueRaw) : null,
      isPaid: booleanValue(formData, 'isPaid'),
      notes: nullableString(formData, 'notes'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar vínculo</DialogTitle>
          <DialogDescription>Acompanhe aluno, turma, entrega, devolução e pagamento.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Figurino">
              <NativeSelect
                name="costumeId"
                required
                defaultValue={assignment.costume.id}
                placeholder="Selecione"
                options={costumes.map((item) => ({ value: item.id, label: item.name }))}
              />
            </Field>
            <Field label="Aluno">
              <NativeSelect
                name="alunoId"
                defaultValue={assignment.aluno?.id || ""}
                placeholder="Opcional"
                options={(resources?.alunos ?? []).map((item) => ({ value: item.id, label: item.nome }))}
              />
            </Field>
            <Field label="Turma">
              <NativeSelect
                name="turmaId"
                defaultValue={assignment.turma?.id || ""}
                placeholder="Opcional"
                options={(resources?.turmas ?? []).map((item) => ({ value: item.id, label: item.nome }))}
              />
            </Field>
            <Field label="Tamanho definido">
              <Input name="definedSize" defaultValue={assignment.definedSize || ""} className={FILTER_INPUT_CLASS} />
            </Field>
            <Field label="Status">
              <NativeSelect
                name="status"
                defaultValue={assignment.status}
                options={Object.entries(EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Valor cobrado">
              <div className="relative flex items-center">
                <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                  R$
                </span>
                <Input
                  name="chargedValue"
                  type="text"
                  value={chargedValueText}
                  onChange={(e) => setChargedValueText(formatCurrencyInput(e.target.value))}
                  className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                />
              </div>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              name="isPaid"
              type="checkbox"
              defaultChecked={assignment.isPaid}
              className="h-4 w-4 rounded border-slate-300 accent-violet-700"
            />{' '}
            Pago?
          </label>
          <Field label="Observações">
            <Textarea name="notes" defaultValue={assignment.notes || ""} className="rounded-xl border-slate-200" />
          </Field>
          <DialogFooter>
            <Button type="submit">Salvar alterações</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentActions({
  assignment,
  eventId,
  costumes,
  resources,
}: {
  assignment: CostumeAssignmentDTO;
  eventId: string;
  costumes: CostumeDTO[];
  resources?: EventResources;
}) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (status: EventCostumeAssignmentStatus) => updateCostumeAssignment(assignment.id, { status }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Status atualizado', description: 'O status do figurino foi atualizado com sucesso.' });
    },
    onError: (error) => toast.error({ title: 'Erro ao atualizar status', description: (error as Error).message }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCostumeAssignment(assignment.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.assignments(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({ title: 'Vínculo excluído', description: 'O vínculo do figurino foi excluído com sucesso.' });
      setDeleteOpen(false);
    },
    onError: (error) => toast.error({ title: 'Erro ao excluir vínculo', description: (error as Error).message }),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Editar
          </DropdownMenuItem>

          {assignment.status !== 'DELIVERED' && (
            <DropdownMenuItem onClick={() => mutation.mutate('DELIVERED')}>
              Entregar
            </DropdownMenuItem>
          )}

          {assignment.status !== 'RETURNED' && (
            <DropdownMenuItem onClick={() => mutation.mutate('RETURNED')}>
              Devolver
            </DropdownMenuItem>
          )}

          {assignment.status !== 'PENDING' && (
            <DropdownMenuItem onClick={() => mutation.mutate('PENDING')}>
              Marcar como Pendente
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className="text-rose-600 focus:bg-rose-50 hover:bg-rose-50"
            onClick={() => setDeleteOpen(true)}
          >
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditAssignmentFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        eventId={eventId}
        assignment={assignment}
        costumes={costumes}
        resources={resources}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir vínculo de figurino"
        description="Tem certeza que deseja excluir o vínculo deste figurino? Esta ação não poderá ser desfeita."
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => deleteMutation.mutate()}
        loading={deleteMutation.isPending}
      />
    </>
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

  const getCostumeStats = (costumeId: string) => {
    const costumeAssignments = assignmentRows.filter((a) => a.costume.id === costumeId && a.status !== 'CANCELLED');
    const deliveredCount = costumeAssignments.filter((a) => a.status === 'DELIVERED').length;
    const activeCount = costumeAssignments.length;
    return {
      delivered: deliveredCount,
      activeCount,
    };
  };

  return (
    <Tabs defaultValue="costumes" variant="line" className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <TabsList className="overflow-x-auto"><TabsTrigger value="costumes">Figurinos</TabsTrigger><TabsTrigger value="assignments">Entregas</TabsTrigger></TabsList>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <CostumeFormDialog eventId={eventId} trigger={<Button variant="outline" className={OUTLINE_BUTTON_CLASS}><Plus className="h-4 w-4" /> Figurino</Button>} />
          <AssignmentFormDialog eventId={eventId} costumes={costumeRows} resources={resources} trigger={<Button className={PRIMARY_BUTTON_CLASS}><Plus className="h-4 w-4" /> Vínculo</Button>} />
        </div>
      </div>
      <TabsContent value="costumes">
        <TablePanel>
          <DataTable
            paginate={true}
            pageSize={5}
            columns={[
              { id: 'name', header: 'Figurino', width: 'w-[24%]', align: 'left', render: (item: CostumeDTO) => <span className="font-medium text-slate-950">{item.name}</span> },
              { id: 'category', header: 'Categoria', width: 'w-[14%]', align: 'left', render: (item: CostumeDTO) => EVENT_COSTUME_CATEGORY_LABELS[item.category] },
              { id: 'size', header: 'Tamanho', width: 'w-[8%]', align: 'left', render: (item: CostumeDTO) => item.size || '-' },
              { id: 'cost', header: 'Custo', width: 'w-[15%]', align: 'right', render: (item: CostumeDTO) => formatCurrency((item.schoolCost ?? 0) * item.quantity) },
              { id: 'charge', header: 'Valor cobrado', width: 'w-[15%]', align: 'right', render: (item: CostumeDTO) => formatCurrency(item.chargedValue ?? 0) },
              {
                id: 'qty',
                header: 'Estoque / Disp.',
                width: 'w-[14%]',
                align: 'right',
                render: (item: CostumeDTO) => {
                  const stats = getCostumeStats(item.id);
                  const available = item.quantity - stats.activeCount;
                  const inStock = item.quantity - stats.delivered;
                  return (
                    <span className="font-semibold text-slate-900">
                      {inStock}/{available}
                    </span>
                  );
                }
              },
              { id: 'actions', header: 'Ações', width: 'w-[10%]', align: 'right', render: (item: CostumeDTO) => <CostumeActions costume={item} eventId={eventId} /> },
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
            paginate={true}
            pageSize={5}
            columns={[
              { id: 'costume', header: 'Figurino', width: 'w-[22%]', align: 'left', render: (item: CostumeAssignmentDTO) => <span className="font-medium text-slate-950">{item.costume.name}</span> },
              { id: 'student', header: 'Aluno/Turma', width: 'w-[22%]', align: 'left', render: (item: CostumeAssignmentDTO) => item.aluno?.nome || item.turma?.nome || '-' },
              { id: 'status', header: 'Status', width: 'w-[15%]', align: 'center', render: (item: CostumeAssignmentDTO) => {
                const tone = {
                  PENDING: 'warning',
                  ORDERED: 'info',
                  RECEIVED: 'info',
                  DELIVERED: 'success',
                  RETURNED: 'neutral',
                  DAMAGED: 'danger',
                  LOST: 'danger',
                  CANCELLED: 'danger',
                }[item.status] as any;
                return <SoftBadge tone={tone}>{EVENT_COSTUME_ASSIGNMENT_STATUS_LABELS[item.status]}</SoftBadge>;
              } },
              { id: 'value', header: 'Valor', width: 'w-[14%]', align: 'right', render: (item: CostumeAssignmentDTO) => formatCurrency(item.chargedValue ?? 0) },
              { id: 'paid', header: 'Pago?', width: 'w-[13%]', align: 'center', render: (item: CostumeAssignmentDTO) => item.isPaid ? <SoftBadge tone="success">Pago</SoftBadge> : <SoftBadge tone="warning">Pendente</SoftBadge> },
              { id: 'actions', header: 'Ações', width: 'w-[14%]', align: 'right', render: (item: CostumeAssignmentDTO) => <AssignmentActions assignment={item} eventId={eventId} costumes={costumeRows} resources={resources} /> },
            ]}
            data={assignmentRows}
            rowKey={(item) => item.id}
            loading={assignments.isLoading}
            emptyMessage={<EmptyState title="Nenhuma entrega registrada." description="Vincule figurinos a alunos ou turmas para acompanhar entrega e devolução." />}
          />
        </TablePanel>
      </TabsContent>
    </Tabs>
  );
}

function FinancialFormDialog({ eventId, type, trigger }: { eventId: string; type: EventFinancialEntryType; trigger: React.ReactNode }) {
  const queryClient = useQueryClient();
  const statuses: EventFinancialEntryStatus[] = type === 'COST' ? ['EXPECTED', 'PENDING', 'PAID'] : ['EXPECTED', 'PENDING', 'RECEIVED'];
  const [open, setOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<EventFinancialEntryStatus>(statuses[0]);
  const [amountText, setAmountText] = useState("");

  const mutation = useMutation({
    mutationFn: createFinancialEntry,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) }),
        queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) }),
      ]);
      toast.success({
        title: type === 'COST' ? 'Custo lançado' : 'Receita lançada',
        description: type === 'COST' ? 'O lançamento de custo foi registrado com sucesso.' : 'O lançamento de receita foi registrado com sucesso.'
      });
      setOpen(false);
      setAmountText("");
      setSelectedStatus(statuses[0]);
    },
    onError: (error) => toast.error({ title: 'Erro no lançamento', description: (error as Error).message }),
  });

  function submit(formData: FormData) {
    const status = nullableString(formData, 'status') as EventFinancialEntryStatus;
    const isRealized = status === 'PAID' || status === 'RECEIVED';

    const category = nullableString(formData, 'category');
    const description = nullableString(formData, 'description');
    const supplier = nullableString(formData, 'supplier');
    const notes = nullableString(formData, 'notes');
    
    let expectedAmount = 0;
    let actualAmount: number | undefined = undefined;
    let dueDate: string | undefined = undefined;
    let realizedAt: string | undefined = undefined;
    let paymentMethod: string | undefined = undefined;

    if (isRealized) {
      const actualAmountRaw = nullableString(formData, 'actualAmount') ?? '';
      actualAmount = parseCurrencyInput(actualAmountRaw);
      expectedAmount = actualAmount;
      realizedAt = datetimeValue(formData, 'realizedAt');
      paymentMethod = nullableString(formData, 'paymentMethod');
      dueDate = realizedAt;
    } else {
      const expectedAmountRaw = nullableString(formData, 'expectedAmount') ?? '';
      expectedAmount = parseCurrencyInput(expectedAmountRaw);
      dueDate = datetimeValue(formData, 'dueDate');
    }

    mutation.mutate({
      eventId,
      type,
      category,
      description,
      supplier,
      expectedAmount,
      actualAmount,
      dueDate,
      realizedAt,
      status,
      paymentMethod,
      notes,
    });
  }

  const categories = type === 'COST' ? EVENT_COST_CATEGORIES : EVENT_REVENUE_CATEGORIES;
  const isRealized = selectedStatus === 'PAID' || selectedStatus === 'RECEIVED';

  return (
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val);
      if (!val) {
        setAmountText("");
        setSelectedStatus(statuses[0]);
      }
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{type === 'COST' ? 'Novo custo' : 'Nova receita'}</DialogTitle>
          <DialogDescription>Informe os dados do lançamento para controle financeiro do evento.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Categoria">
              <NativeSelect name="category" required options={categories.map((category) => ({ value: category, label: category }))} />
            </Field>
            <Field label="Status">
              <NativeSelect
                key={selectedStatus}
                name="status"
                defaultValue={selectedStatus}
                onValueChange={(val) => setSelectedStatus(val as EventFinancialEntryStatus)}
                options={statuses.map((status) => ({ value: status, label: EVENT_FINANCIAL_STATUS_LABELS[status] }))}
              />
            </Field>
            <Field label="Descrição">
              <Input name="description" required className={FILTER_INPUT_CLASS} />
            </Field>
            {type === 'COST' ? (
              <Field label="Fornecedor">
                <Input name="supplier" className={FILTER_INPUT_CLASS} />
              </Field>
            ) : null}

            {isRealized ? (
              <>
                <Field label={type === 'COST' ? 'Valor pago' : 'Valor recebido'}>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                      R$
                    </span>
                    <Input
                      name="actualAmount"
                      type="text"
                      value={amountText}
                      onChange={(e) => setAmountText(formatCurrencyInput(e.target.value))}
                      className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                      required
                    />
                  </div>
                </Field>
                <Field label={type === 'COST' ? 'Data de pagamento' : 'Data de recebimento'}>
                  <DateTimeField name="realizedAt" defaultValue={getRoundedNowISOString()} />
                </Field>
                <Field label="Forma de pagamento">
                  <NativeSelect
                    name="paymentMethod"
                    placeholder="Opcional"
                    options={EVENT_PAYMENT_METHODS.filter((method) => method !== 'COMPLIMENTARY').map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Valor previsto">
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                      R$
                    </span>
                    <Input
                      name="expectedAmount"
                      type="text"
                      value={amountText}
                      onChange={(e) => setAmountText(formatCurrencyInput(e.target.value))}
                      className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                      required
                    />
                  </div>
                </Field>
                <Field label="Data prevista">
                  <DateTimeField name="dueDate" />
                </Field>
              </>
            )}
          </div>
          <Field label="Observações">
            <Textarea name="notes" className="rounded-xl border-slate-200" />
          </Field>
          <DialogFooter>
            <Button type="submit">Salvar lançamento</Button>
          </DialogFooter>
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
          paginate={true}
          pageSize={5}
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
            { id: 'status', header: 'Status', width: 'w-[12%]', align: 'center', render: (entry: FinancialEntryDTO) => {
              const tone = {
                EXPECTED: 'neutral',
                PENDING: 'warning',
                PAID: 'success',
                RECEIVED: 'success',
                CANCELLED: 'danger',
                REFUNDED: 'neutral',
              }[entry.status] as any;
              return <SoftBadge tone={tone}>{EVENT_FINANCIAL_STATUS_LABELS[entry.status]}</SoftBadge>;
            } },
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

function formatCurrencyInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const intVal = parseInt(digits, 10);
  const valor = (intVal / 100).toFixed(2).replace('.', ',');
  return valor;
}

function parseCurrencyInput(str: string): number {
  if (!str.trim()) return 0;
  const normalized = str.replace(/\./g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

export function EventDetailFeature({ eventId }: { eventId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [billingMethod, setBillingMethod] = useState("");
  const [chargeType, setChargeType] = useState<"ONE_TIME" | "INSTALLMENT">("ONE_TIME");
  const resources = useEventResources();
  const eventQuery = useQuery({ queryKey: eventQueryKeys.event(eventId), queryFn: () => getEvent(eventId) });
  const event = eventQuery.data;

  // Dialog and Student Autocomplete States
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState<{ value: string; label: string; description?: string }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; nome: string } | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);
  const [feeText, setFeeText] = useState("");
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [participantToDelete, setParticipantToDelete] = useState<{ id: string; name: string } | null>(null);

  // Clear dialog state when opened/closed
  useEffect(() => {
    if (isRegisterOpen) {
      const defaultFee = event?.registrationFee ?? 0;
      setFeeText(defaultFee > 0 ? (defaultFee).toFixed(2).replace('.', ',') : "0,00");
    } else {
      setStudentQuery('');
      setStudentResults([]);
      setSearchLoading(false);
      setShowSuggestions(false);
      setSelectedStudent(null);
      setHighlightedIndex(0);
      setBillingMethod("");
      setChargeType("ONE_TIME");
      setFeeText("");
      setDueDate(undefined);
    }
  }, [isRegisterOpen, event?.registrationFee]);

  // Autocomplete search handler
  useEffect(() => {
    if (!isRegisterOpen) return;
    const term = studentQuery.trim();
    if (term.length < 2 || (selectedStudent && term === selectedStudent.nome)) {
      setStudentResults([]);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/alunos?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const json = await res.json();
        const items = json?.items ?? [];
        setStudentResults(items.map((item: any) => ({
          value: item.id,
          label: item.nome,
          description: item.cpf || item.email || undefined,
        })));
        setHighlightedIndex(0);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error(err);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [studentQuery, isRegisterOpen, selectedStudent]);

  // Query Participants
  const participantsQuery = useQuery({
    queryKey: ['events', 'participants', eventId],
    queryFn: () => listEventParticipants(eventId),
  });

  const participants = participantsQuery.data ?? [];

  // Mutations
  const registerMutation = useMutation({
    mutationFn: (payload: Record<string, any>) => registerEventParticipant(eventId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) });
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) });
      setIsRegisterOpen(false);
      toast.success({ title: 'Aluno inscrito', description: 'A inscrição do participante foi realizada com sucesso.' });
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao inscrever aluno', description: error.message });
    },
  });

  const unregisterMutation = useMutation({
    mutationFn: (participantId: string) => unregisterEventParticipant(eventId, participantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'participants', eventId] });
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.event(eventId) });
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.finance(eventId) });
      toast.success({ title: 'Inscrição removida', description: 'A inscrição do participante foi removida do evento.' });
      setParticipantToDelete(null);
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao remover inscrição', description: error.message });
      setParticipantToDelete(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/events/${eventId}`, { method: 'DELETE' }).then(async (res) => {
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error?.message || 'Erro ao deletar evento');
        }
        return res.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventQueryKeys.events });
      toast.success({ title: 'Evento excluído', description: 'O evento foi removido com sucesso.' });
      router.push('/events');
    },
    onError: (error) => {
      toast.error({ title: 'Erro ao excluir evento', description: error.message });
    },
  });

  if (eventQuery.isLoading) {
    return <div className="h-80 animate-pulse rounded-xl bg-slate-100" />;
  }

  if (!event) {
    return <EmptyState title="Evento não encontrado." description="Verifique se o evento existe e pertence à conta atual." />;
  }

  // Handle participant register submit
  function handleRegisterParticipant(formData: FormData) {
    const alunoId = selectedStudent?.id || '';
    if (!alunoId) {
      toast.error({ title: 'Aviso', description: 'Por favor, selecione um aluno válido.' });
      return;
    }
    const registrationFeeCharged = parseCurrencyInput(String(formData.get('registrationFeeCharged') || '0'));
    const selectedBilling = String(formData.get('billingMethod') || 'MANUAL_RECEIVED');
    const isFeePaid = selectedBilling === 'MANUAL_RECEIVED';
    const feePaymentMethod = isFeePaid ? String(formData.get('feePaymentMethod') || 'OTHER') : selectedBilling;
    const notes = String(formData.get('notes') || '');

    const resolvedChargeType = selectedBilling === 'PIX' ? 'ONE_TIME' : String(formData.get('chargeType') || 'ONE_TIME');
    const dueDate = formData.get('dueDate') ? String(formData.get('dueDate')) : undefined;
    if (selectedBilling !== 'MANUAL_RECEIVED' && !dueDate) {
      toast.error({ title: 'Aviso', description: 'Por favor, selecione a data de vencimento da primeira cobrança.' });
      return;
    }
    const installmentCount = resolvedChargeType === 'INSTALLMENT' ? Number(formData.get('installmentCount') || 2) : undefined;

    registerMutation.mutate({
      alunoId,
      registrationFeeCharged,
      billingMethod: selectedBilling,
      feePaymentMethod: registrationFeeCharged > 0 ? feePaymentMethod : undefined,
      notes,
      chargeType: resolvedChargeType,
      dueDate,
      installmentCount,
    });
  }

  const cleanFeeText = feeText.replace(/[^\d,]/g, '').replace(',', '.');
  const totalFeeVal = parseFloat(cleanFeeText) || 0;
  
  const installmentOptions = [];
  if (totalFeeVal > 0) {
    for (let i = 2; i <= 12; i++) {
      const instVal = totalFeeVal / i;
      if (instVal >= 5.0) {
        installmentOptions.push({
          value: String(i),
          label: `${i}x de R$ ${instVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        });
      }
    }
  }
  if (installmentOptions.length === 0) {
    for (let i = 2; i <= 12; i++) {
      installmentOptions.push({
        value: String(i),
        label: `${i}x`,
      });
    }
  }

  return (
    <div className="space-y-8 pb-16">
      {/* 1. Header */}
      <EventHeader event={event} />

      {/* 2. Métricas Gerais (KPIs) */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard label="Alunos inscritos" value={participants.length} icon={ClipboardList} tone="info" />
        <MetricCard label="Lucro Bruto" value={formatCurrency(event.metrics.lucroBrutoRealizado)} icon={CircleDollarSign} tone="success" />
        <MetricCard label="Lucro Líquido" value={formatCurrency(event.metrics.lucroLiquidoRealizado)} icon={BarChart3} tone={event.metrics.lucroLiquidoRealizado >= 0 ? 'success' : 'danger'} />
        <MetricCard label="Lucro Estimado" value={formatCurrency(event.metrics.resultadoPrevisto)} icon={BarChart3} tone={event.metrics.resultadoPrevisto >= 0 ? 'success' : 'danger'} />
        <MetricCard label="Custo do Evento" value={formatCurrency(event.metrics.custoRealizado)} icon={WalletCards} tone="warning" />
      </div>

      {/* 4. Alunos Inscritos */}
      <Card className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <CardHeader className="p-0 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold text-slate-800">Participantes Inscritos</CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              Alunos vinculados ao evento, controle de pagamento da taxa e total investido pelo aluno.
            </p>
          </div>
          {/* Inscrever Aluno Trigger */}
          <Dialog open={isRegisterOpen} onOpenChange={setIsRegisterOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className={PRIMARY_BUTTON_CLASS} onClick={() => setIsRegisterOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Inscrever aluno
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto pr-2">
              <DialogHeader>
                <DialogTitle>Inscrever Aluno no Evento</DialogTitle>
                <DialogDescription>Selecione um aluno cadastrado e especifique a taxa cobrada.</DialogDescription>
              </DialogHeader>
              <form key={isRegisterOpen ? 'open' : 'closed'} action={handleRegisterParticipant} className="space-y-4 mt-2">
                <Field label="Aluno">
                  <div className="relative">
                    <Input
                      type="text"
                      value={studentQuery}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStudentQuery(val);
                        setShowSuggestions(true);
                        if (selectedStudent && val !== selectedStudent.nome) {
                          setSelectedStudent(null);
                        }
                      }}
                      onFocus={() => setShowSuggestions(true)}
                      onBlur={() => {
                        // Defer click selection
                        setTimeout(() => setShowSuggestions(false), 200);
                      }}
                      onKeyDown={(e) => {
                        if (!studentResults.length) return;
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setHighlightedIndex((curr) => Math.min(curr + 1, studentResults.length - 1));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setHighlightedIndex((curr) => Math.max(curr - 1, 0));
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          const opt = studentResults[highlightedIndex];
                          if (opt) {
                            setSelectedStudent({ id: opt.value, nome: opt.label });
                            setStudentQuery(opt.label);
                            setShowSuggestions(false);
                          }
                        } else if (e.key === 'Escape') {
                          setShowSuggestions(false);
                        }
                      }}
                      className={FILTER_INPUT_CLASS}
                      placeholder="Busque pelo nome do aluno..."
                      required
                    />
                    
                    {/* Autocomplete suggestions dropdown */}
                    {showSuggestions && (studentQuery.trim().length >= 2 || searchLoading) && (
                      <AutocompleteList
                        id="event-student-suggestions"
                        options={studentResults}
                        highlightedIndex={highlightedIndex}
                        selectedValue={selectedStudent?.id || undefined}
                        onSelect={(opt) => {
                          setSelectedStudent({ id: opt.value, nome: opt.label });
                          setStudentQuery(opt.label);
                          setShowSuggestions(false);
                        }}
                        renderDescription={(opt) => opt.description}
                        className="max-h-48 shadow-lg rounded-lg border border-slate-200 bg-white"
                      />
                    )}
                  </div>
                  {selectedStudent && (
                    <p className="text-xs text-slate-500 mt-1">
                      Selecionado: <span className="font-semibold text-slate-900">{selectedStudent.nome}</span>
                    </p>
                  )}
                </Field>
                <Field label="Forma de Cobrança">
                  <NativeSelect
                    name="billingMethod"
                    placeholder="Selecione a forma de cobrança"
                    required
                    onValueChange={(val) => {
                      setBillingMethod(val);
                      if (val === 'PIX') {
                        setChargeType('ONE_TIME');
                      }
                    }}
                    options={[
                      { value: "MANUAL_RECEIVED", label: "Quitado na hora (Manual)" },
                      { value: "BOLETO", label: "Boleto" },
                      { value: "PIX", label: "Pix" },
                      { value: "CREDIT_CARD", label: "Cartão de Crédito" }
                    ]}
                  />
                </Field>
                
                {billingMethod && (
                  <div className="space-y-4">
                    <Field label="Taxa de inscrição cobrada">
                      <div className="relative flex items-center">
                        <span className="absolute left-3 text-xs font-semibold text-slate-400 pointer-events-none">
                          R$
                        </span>
                        <Input
                          name="registrationFeeCharged"
                          type="text"
                          value={feeText}
                          onChange={(e) => setFeeText(formatCurrencyInput(e.target.value))}
                          className={cn(FILTER_INPUT_CLASS, "pl-10 text-right")}
                          required
                        />
                      </div>
                    </Field>

                    {/* Campo condicional para forma de pagamento manual */}
                    <input type="hidden" name="isManual" value={billingMethod === "MANUAL_RECEIVED" ? "true" : "false"} />
                    {billingMethod === "MANUAL_RECEIVED" && (
                      <Field label="Forma de recebimento">
                        <NativeSelect
                          name="feePaymentMethod"
                          defaultValue="MANUAL_PIX"
                          options={EVENT_PAYMENT_METHODS.filter(m => m !== "COMPLIMENTARY").map((method) => ({ value: method, label: EVENT_PAYMENT_METHOD_LABELS[method] }))}
                        />
                      </Field>
                    )}

                    {/* Campos dinâmicos para cobranças digitais */}
                    {billingMethod !== "MANUAL_RECEIVED" && (
                      <>
                        <Field label="Tipo de cobrança">
                          <NativeSelect
                            name="chargeType"
                            defaultValue={billingMethod === 'PIX' ? 'ONE_TIME' : chargeType}
                            onValueChange={(val) => setChargeType(val as any)}
                            options={
                              billingMethod === 'PIX'
                                ? [{ value: 'ONE_TIME', label: 'À vista' }]
                                : [
                                    { value: 'ONE_TIME', label: 'À vista' },
                                    { value: 'INSTALLMENT', label: 'Parcelado' },
                                  ]
                            }
                          />
                        </Field>
                        
                        <Field label="Vencimento da primeira cobrança">
                          <input type="hidden" name="dueDate" value={dueDate ? dueDate.toISOString().split('T')[0] : ''} />
                          <DatePicker
                            value={dueDate}
                            onChange={setDueDate}
                            variant="input"
                            placeholder="dd/mm/aaaa"
                            className={FILTER_INPUT_CLASS}
                            readOnlyInput
                          />
                        </Field>

                        {chargeType === 'INSTALLMENT' && billingMethod !== 'PIX' && (
                          <Field label="Quantidade de parcelas">
                            <NativeSelect
                              name="installmentCount"
                              defaultValue="2"
                              options={installmentOptions}
                            />
                          </Field>
                        )}
                      </>
                    )}
                  </div>
                )}
                <Field label="Observações">
                  <Textarea name="notes" className="min-h-16 rounded-lg border-slate-200" />
                </Field>
                <DialogFooter className="pt-2">
                  <Button type="submit" disabled={registerMutation.isPending} className="w-full">
                    {registerMutation.isPending ? 'Inscrevendo...' : 'Confirmar inscrição'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          <TablePanel>
            <DataTable
              paginate={true}
              pageSize={5}
              columns={[
                {
                  id: 'student',
                  header: 'Aluno',
                  width: 'w-[20%]',
                  align: 'left',
                  render: (part) => (
                    <div className="flex items-center gap-2 lg:gap-3 min-w-0">
                      <PersonAvatar
                        name={part.displayName}
                        src={part.aluno?.foto}
                        size="sm"
                        className="h-8 w-8 shrink-0"
                      />
                      <span className="font-semibold text-slate-900 truncate">
                        {part.displayName}
                      </span>
                    </div>
                  ),
                },
                {
                  id: 'fee',
                  header: 'Taxa Inscrição',
                  width: 'w-[15%]',
                  align: 'left',
                  render: (part) => {
                    if (part.registrationFeeCharged === 0) {
                      return <span className="text-slate-500 font-medium">Grátis</span>;
                    }
                    return <span className="text-slate-900 font-medium">{formatCurrency(part.registrationFeeCharged)}</span>;
                  },
                },
                {
                  id: 'percentPaid',
                  header: 'Valor pago',
                  width: 'w-[15%]',
                  align: 'left',
                  render: (part) => {
                    const pct = (part.registrationFeeCharged === 0 || part.isFeePaid) ? '100%' : '0%';
                    return <span className="font-semibold text-slate-900">{pct}</span>;
                  },
                },
                {
                  id: 'paymentMethod',
                  header: 'Forma Pagamento',
                  width: 'w-[20%]',
                  align: 'left',
                  render: (part) => {
                    if (part.registrationFeeCharged === 0 || !part.isFeePaid) {
                      return <span className="text-slate-400">—</span>;
                    }
                    return (
                      <span className="text-slate-700 text-sm font-medium">
                        {part.feePaymentMethod ? EVENT_PAYMENT_METHOD_LABELS[part.feePaymentMethod as keyof typeof EVENT_PAYMENT_METHOD_LABELS] : 'Pago'}
                      </span>
                    );
                  },
                },
                {
                  id: 'status',
                  header: 'Status',
                  width: 'w-[15%]',
                  align: 'left',
                  render: (part) => {
                    if (part.registrationFeeCharged === 0) {
                      return <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Isento</span>;
                    }
                    if (part.isFeePaid) {
                      return <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Pago</span>;
                    }
                    return <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Pendente</span>;
                  },
                },
                {
                  id: 'actions',
                  header: 'Ações',
                  width: 'w-[15%]',
                  align: 'right',
                  render: (part) => (
                    <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-slate-500 hover:text-[#A94DFF] hover:bg-slate-50/50"
                        onClick={() => {
                          router.push(`/events/${eventId}/participants/${part.id}`);
                        }}
                        title="Ver detalhes"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50/50"
                        onClick={() => setParticipantToDelete({ id: part.id, name: part.displayName })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ),
                },
              ]}
              data={participants}
              rowKey={(part) => part.id}
              loading={participantsQuery.isLoading}
              onRowClick={(part) => {
                router.push(`/events/${eventId}/participants/${part.id}`);
              }}
              emptyMessage={<EmptyState title="Nenhum aluno inscrito." description="Inscreva manualmente os alunos participantes do evento." />}
            />
          </TablePanel>
        </CardContent>
      </Card>

      {/* 5. Seção de Figurinos (Se ativo) */}
      {event.hasCostumes && (
        <Card className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-base font-semibold text-slate-800">Controle de Figurinos</CardTitle>
            <p className="text-xs text-slate-500 mt-1">Gestão de entregas, tamanhos definidos e status de pagamentos.</p>
          </CardHeader>
          <CardContent className="p-0">
            <EventCostumesPanel eventId={eventId} resources={resources.data} />
          </CardContent>
        </Card>
      )}

      {/* 6. Seção de Ingressos (Se ativo) */}
      {event.hasTickets && (
        <Card className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-base font-semibold text-slate-800">Ingressos & Bilheteria</CardTitle>
            <p className="text-xs text-slate-500 mt-1">Acompanhe lotes ativos, vendas realizadas e cortesias emitidas.</p>
          </CardHeader>
          <CardContent className="p-0">
            <EventTicketsPanel eventId={eventId} resources={resources.data} />
          </CardContent>
        </Card>
      )}

      {/* 7. Seção Financeira (Se ativo) */}
      {event.hasFinancialControl && (
        <Card className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-base font-semibold text-slate-800">Fluxo de Caixa Operacional</CardTitle>
            <p className="text-xs text-slate-500 mt-1">Controle detalhado de receitas de bilheteria/taxas e despesas com fornecedores.</p>
          </CardHeader>
          <CardContent className="p-0">
            <EventFinancialPanel eventId={eventId} event={event} />
          </CardContent>
        </Card>
      )}

      {/* 8. Mapa do Evento */}
      {event.hasTickets && event.ticketMode !== 'SIMPLE' && (
        <Card className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-base font-semibold text-slate-800">Mapa do Evento</CardTitle>
            <p className="text-xs text-slate-500 mt-1">Organize setores, fileiras e assentos para a bilheteria.</p>
          </CardHeader>
          <CardContent className="p-0">
            <EventMapPanel event={event} />
          </CardContent>
        </Card>
      )}


      {/* 9. Zona de Perigo / Deletar Evento */}
      <Card className="rounded-xl border border-rose-200 bg-rose-50/10 p-5 shadow-sm mt-8">
        <CardHeader className="p-0 pb-4">
          <CardTitle className="text-base font-semibold text-rose-800">Zona de Perigo</CardTitle>
          <p className="text-xs text-rose-600 mt-1">
            Excluir permanentemente este evento e todos os seus dados associados (ingressos, figurinos, participantes e registros de caixa). Esta ação não pode ser desfeita.
          </p>
        </CardHeader>
        <CardContent className="p-0 pt-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="destructive" className="bg-rose-600 hover:bg-rose-700 text-white font-medium">
                Excluir Evento
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-rose-800">Excluir Evento</DialogTitle>
                <DialogDescription>
                  Você tem certeza que deseja excluir o evento <strong>{event.name}</strong>? Todos os dados associados a este evento serão permanentemente perdidos.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <DialogClose asChild>
                  <Button variant="outline">Cancelar</Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  className="bg-rose-600 hover:bg-rose-700 text-white"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Excluindo...' : 'Confirmar Exclusão'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={participantToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setParticipantToDelete(null);
        }}
        title="Remover inscrição"
        description={`Tem certeza que deseja remover a inscrição de ${participantToDelete?.name}?`}
        confirmText="Remover"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={() => {
          if (participantToDelete) {
            unregisterMutation.mutate(participantToDelete.id);
          }
        }}
        loading={unregisterMutation.isPending}
      />
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
