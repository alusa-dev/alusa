import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { ErrorState } from '@/components/feedback/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { EventActionsFab } from '@/features/events/components/EventActionsFab';
import { EventFinancialSection } from '@/features/events/components/EventFinancialSection';
import { EventParticipantsSection } from '@/features/events/components/EventParticipantsSection';
import { EventDetailSkeleton } from '@/features/events/components/EventSkeleton';
import { eventsService } from '@/features/events/services/events-service';
import type { MobileEvent } from '@/features/events/types/events';
import { eventStatusLabel, eventTypeLabel, formatCurrency, formatEventDate } from '@/features/events/utils/format';
import { colors, radius, spacing } from '@/theme/tokens';

export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const normalizedEventId = typeof eventId === 'string' ? eventId : '';
  const [event, setEvent] = useState<MobileEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const loadEvent = useCallback(async (silent = false) => {
    if (!normalizedEventId) {
      setError('Não foi possível identificar o evento.');
      return;
    }

    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await eventsService.getEvent(normalizedEventId);
      setEvent(response.event);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o evento.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [normalizedEventId]);

  useEffect(() => {
    void loadEvent();
  }, [loadEvent]);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      await loadEvent(true);
      setRefreshKey((value) => value + 1);
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [loadEvent]);

  const handleChanged = useCallback(async () => {
    await loadEvent(true);
    setRefreshKey((value) => value + 1);
  }, [loadEvent]);

  return (
    <Screen
      scroll
      backgroundColor={colors.surface}
      style={styles.screen}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      overlay={!loading && !error && event ? <EventActionsFab event={event} onChanged={handleChanged} /> : undefined}
    >
      <PageHeader title="Detalhes do evento" onBack={() => router.back()} />

      {loading ? <EventDetailSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Voltar" onAction={() => router.back()} /> : null}
      {!loading && !error && event ? <EventContent event={event} refreshKey={refreshKey} onChanged={handleChanged} /> : null}
    </Screen>
  );
}

function EventContent({ event, refreshKey, onChanged }: { event: MobileEvent; refreshKey: number; onChanged: () => void | Promise<void> }) {
  const statusTone = getStatusTone(event.status);
  return (
    <View style={styles.content}>
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <AppText variant="subheading" weight="medium" numberOfLines={2} style={styles.heroTitle}>{event.name}</AppText>
          <View style={[styles.statusBadge, { backgroundColor: statusTone.background }]}>
            <View style={[styles.statusDot, { backgroundColor: statusTone.foreground }]} />
            <AppText variant="tiny" weight="medium" style={{ color: statusTone.foreground }}>{eventStatusLabel(event.status)}</AppText>
          </View>
        </View>
        <AppText variant="small" tone="muted">{eventTypeLabel(event.type)}</AppText>
        <View style={styles.heroDivider} />
        <InfoRow label="Data e horário" value={formatEventDate(event.startsAt)} />
        <InfoRow label="Local" value={event.locationName || 'Local não informado'} />
        {event.locationAddress ? <InfoRow label="Endereço" value={event.locationAddress} /> : null}
      </View>

      <View style={styles.summaryCard}>
        <AppText variant="subheading" weight="medium">Visão geral</AppText>
        <View style={styles.metricGrid}>
          <Metric label="Ingressos vendidos" value={String(event.metrics.ingressosVendidos)} />
          <Metric label="Ingressos disponíveis" value={String(event.metrics.ingressosDisponiveis)} />
          <Metric label="Receita recebida" value={formatCurrency(event.metrics.receitaRealizada)} />
          <Metric label="Resultado realizado" value={formatCurrency(event.metrics.resultadoRealizado)} />
        </View>
      </View>

      <EventParticipantsSection
        eventId={event.id}
        refreshKey={refreshKey}
        onParticipantPress={(participant) => {
          if (participant.alunoId) {
            router.push({ pathname: '/(app)/students/[studentId]', params: { studentId: participant.alunoId } });
          }
        }}
        onViewAll={() => router.push({ pathname: '/(app)/events/[eventId]/participants', params: { eventId: event.id } })}
      />

      {event.hasTickets ? (
        <SectionCard title="Ingressos">
          <InfoRow label="Lotes configurados" value={String(event.counts.lots)} />
          <InfoRow label="Vendas registradas" value={String(event.counts.ticketSales)} />
          <InfoRow label="Ocupação" value={event.metrics.taxaOcupacao == null ? 'Não informada' : `${Math.round(event.metrics.taxaOcupacao * 100)}%`} />
        </SectionCard>
      ) : null}

      {event.hasCostumes ? (
        <SectionCard title="Figurinos">
          <InfoRow label="Pendentes" value={String(event.metrics.figurinosPendentes)} />
          <InfoRow label="Entregues" value={String(event.metrics.figurinosEntregues)} />
          <InfoRow label="Devolvidos" value={String(event.metrics.figurinosDevolvidos)} />
        </SectionCard>
      ) : null}

      {event.hasFinancialControl && event.capabilities.canViewFinancial ? (
        <SectionCard title="Resumo financeiro">
          <InfoRow label="Receita prevista" value={formatCurrency(event.metrics.receitaPrevista)} />
          <InfoRow label="Receita recebida" value={formatCurrency(event.metrics.receitaRealizada)} />
          <InfoRow label="Custos realizados" value={formatCurrency(event.metrics.custoRealizado)} />
          <InfoRow label="Resultado realizado" value={formatCurrency(event.metrics.resultadoRealizado)} />
        </SectionCard>
      ) : null}

      <EventFinancialSection
        eventId={event.id}
        enabled={event.hasFinancialControl && event.capabilities.canViewFinancial}
        canManage={event.capabilities.canManageFinancial}
        refreshKey={refreshKey}
        onChanged={onChanged}
        onViewAll={() => router.push({ pathname: '/(app)/events/[eventId]/financial', params: { eventId: event.id } })}
      />

      {event.description || event.notes ? (
        <SectionCard title="Observações">
          {event.description ? <InfoRow label="Descrição" value={event.description} /> : null}
          {event.notes ? <InfoRow label="Notas" value={event.notes} /> : null}
        </SectionCard>
      ) : null}

    </View>
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.sectionCard}><AppText variant="subheading" weight="medium">{title}</AppText><View style={styles.rows}>{children}</View></View>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.infoRow}><AppText variant="small" tone="muted">{label}</AppText><AppText numberOfLines={3} style={styles.infoValue}>{value}</AppText></View>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><AppText variant="tiny" tone="muted" numberOfLines={2}>{label}</AppText><AppText variant="subheading" weight="medium" numberOfLines={1} adjustsFontSizeToFit>{value}</AppText></View>;
}

function getStatusTone(status: string) {
  if (status === 'ACTIVE') return { foreground: colors.success, background: colors.accentSoft };
  if (status === 'CANCELLED') return { foreground: colors.danger, background: colors.dangerSoft };
  if (status === 'FINISHED') return { foreground: colors.brand, background: colors.brandSoft };
  return { foreground: colors.warning, background: colors.surfaceSoft };
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: spacing['2xl'] },
  content: { gap: spacing.lg },
  heroCard: { gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  heroHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  heroTitle: { flex: 1 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  statusDot: { width: 7, height: 7, borderRadius: radius.pill },
  heroDivider: { height: 1, backgroundColor: colors.border },
  summaryCard: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.md },
  metric: { width: '47%', minHeight: 62, justifyContent: 'space-between', gap: spacing.xs },
  sectionCard: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  rows: { gap: spacing.md },
  infoRow: { gap: spacing.xs },
  infoValue: { flexShrink: 1 },
});
