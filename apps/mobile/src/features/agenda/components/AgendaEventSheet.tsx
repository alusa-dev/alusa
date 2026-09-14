import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CalendarDaysIcon, CheckCircleIcon, PencilSquareIcon, UserGroupIcon, XCircleIcon } from 'react-native-heroicons/outline';

import { BottomSheet } from '@/components/overlays/BottomSheet';
import { AppText } from '@/components/primitives/AppText';
import { agendaService } from '../services/agenda-service';
import type { CalendarEventDetails, CalendarEventStatus } from '../types/agenda';
import { dateKeyInTimeZone, longDateLabel, timeInTimeZone } from '../utils/date';
import { colors, radius, spacing } from '@/theme/tokens';

function statusLabel(status: CalendarEventStatus) {
  if (status === 'REALIZADO') return 'Realizado';
  if (status === 'CANCELADO') return 'Cancelado';
  return 'Agendado';
}

function statusColor(status: CalendarEventStatus) {
  if (status === 'REALIZADO') return colors.success;
  if (status === 'CANCELADO') return colors.danger;
  return colors.warning;
}

function typeLabel(type: CalendarEventDetails['type']) {
  return type.toLowerCase().replace(/_/g, ' ');
}

function addDaysToDateKey(value: string, amount: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
  date.setDate(date.getDate() + amount);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function AgendaEventSheet({
  visible,
  eventId,
  onClose,
  onRefresh,
  onRequestEdit,
  onRequestAttendance,
}: {
  visible: boolean;
  eventId: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onRequestEdit: (_event: CalendarEventDetails) => void;
  onRequestAttendance: (_event: CalendarEventDetails) => void;
}) {
  const [event, setEvent] = useState<CalendarEventDetails | null>(null);
  const [timeZone, setTimeZone] = useState('America/Sao_Paulo');
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState<CalendarEventStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !eventId) {
      setEvent(null);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    void agendaService.getEvent(eventId)
      .then((result) => {
        if (!active) return;
        setEvent(result.data);
        setTimeZone(result.timeZone);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o evento.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [eventId, visible]);

  const now = Date.now();
  const eventStarted = Boolean(event && new Date(event.startAt).getTime() <= now);
  const canEdit = Boolean(event && event.status === 'AGENDADO' && !eventStarted);
  const canMarkAsDone = Boolean(event && event.status === 'AGENDADO' && eventStarted);
  const canCancel = canEdit;
  const canAttendance = Boolean(
    event &&
      (event.type === 'AULA' || event.type === 'REPOSICAO') &&
      event.status !== 'CANCELADO' &&
      dateKeyInTimeZone(event.startAt, timeZone) <= dateKeyInTimeZone(new Date(), timeZone) &&
      dateKeyInTimeZone(new Date(), timeZone) <= addDaysToDateKey(dateKeyInTimeZone(event.startAt, timeZone), 7),
  );

  const eventDate = useMemo(() => {
    if (!event) return '';
    const key = dateKeyInTimeZone(event.startAt, timeZone);
    return longDateLabel(new Date(`${key}T12:00:00`), timeZone);
  }, [event, timeZone]);

  async function updateStatus(status: CalendarEventStatus) {
    if (!event) return;
    try {
      setUpdating(status);
      setError(null);
      const result = await agendaService.updateEvent(event.id, { status });
      setEvent(result.data);
      setTimeZone(result.timeZone);
      onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o evento.');
    } finally {
      setUpdating(null);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="88%" accessibilityLabel="Detalhes do evento">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.loading}><AppText tone="muted">Carregando evento...</AppText></View>
        ) : error && !event ? (
          <View style={styles.errorBox}><AppText variant="small" tone="danger">{error}</AppText></View>
        ) : event ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIcon}><CalendarDaysIcon color={colors.brand} size={28} strokeWidth={1.8} /></View>
              <AppText variant="subheading" weight="medium" numberOfLines={2} style={styles.heroTitle}>{event.title}</AppText>
              <AppText tone="muted" numberOfLines={1}>{eventDate}</AppText>
              <AppText variant="display" weight="medium" style={styles.heroTime}>{timeInTimeZone(event.startAt, timeZone)} – {timeInTimeZone(event.endAt, timeZone)}</AppText>
              <View style={styles.badgeRow}>
                <View style={[styles.statusPill, { backgroundColor: `${statusColor(event.status)}18` }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor(event.status) }]} />
                  <AppText variant="small" weight="medium" style={{ color: statusColor(event.status) }}>{statusLabel(event.status)}</AppText>
                </View>
                <View style={styles.typePill}><AppText variant="small" tone="muted" weight="medium">{typeLabel(event.type)}</AppText></View>
              </View>
            </View>

            <View style={styles.detailCard}>
              <DetailRow label="Turma" value={event.turma?.label ?? 'Sem turma'} />
              <DetailRow label="Sala" value={event.sala?.label ?? 'Sem sala'} />
              <DetailRow label="Professor(es)" value={event.professores.length ? event.professores.map((item) => item.nome).join(', ') : 'Sem professor'} />
              {event.attendanceSummary ? (
                <DetailRow label="Frequência" value={`${event.attendanceSummary.recorded} de ${event.attendanceSummary.totalEligible} registros`} />
              ) : null}
              {event.description ? <DetailRow label="Descrição" value={event.description} /> : null}
            </View>

            {event.conflicts.length > 0 ? (
              <View style={styles.warningBox}><AppText variant="small" tone="danger" weight="medium">Há conflito neste horário.</AppText><AppText variant="tiny" tone="muted">{event.conflicts.map((item) => item.message).join(' ')}</AppText></View>
            ) : null}

            {error ? <View style={styles.errorBox}><AppText variant="small" tone="danger">{error}</AppText></View> : null}

            <View style={styles.actions}>
              {canEdit ? <ActionRow label="Editar evento" Icon={PencilSquareIcon} onPress={() => onRequestEdit(event)} /> : null}
              {canAttendance ? <ActionRow label="Registrar frequência" Icon={UserGroupIcon} onPress={() => onRequestAttendance(event)} /> : null}
              {canMarkAsDone ? <ActionRow label="Marcar como realizado" Icon={CheckCircleIcon} loading={updating === 'REALIZADO'} onPress={() => void updateStatus('REALIZADO')} /> : null}
              {canCancel ? <ActionRow label="Cancelar evento" Icon={XCircleIcon} destructive loading={updating === 'CANCELADO'} onPress={() => Alert.alert('Cancelar evento?', 'Essa ação ficará registrada na agenda.', [{ text: 'Voltar', style: 'cancel' }, { text: 'Cancelar evento', style: 'destructive', onPress: () => void updateStatus('CANCELADO') }])} last /> : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailRow}><AppText variant="small" tone="muted">{label}</AppText><AppText numberOfLines={3} style={styles.detailValue}>{value}</AppText></View>;
}

function ActionRow({ label, Icon, onPress, destructive = false, loading = false, last = false }: { label: string; Icon: typeof PencilSquareIcon; onPress: () => void; destructive?: boolean; loading?: boolean; last?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={loading} onPress={onPress} style={({ pressed }) => [styles.actionRow, !last ? styles.actionDivider : null, pressed ? styles.pressed : null]}>
      <Icon color={destructive ? colors.danger : colors.brand} size={23} strokeWidth={1.8} />
      <AppText weight="medium" style={destructive ? styles.destructive : undefined}>{loading ? 'Atualizando...' : label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingBottom: spacing.sm },
  loading: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  heroIcon: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.brandSoft },
  heroTitle: { textAlign: 'center' },
  heroTime: { fontSize: 30, lineHeight: 36, textAlign: 'center' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  statusPill: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  statusDot: { width: 7, height: 7, borderRadius: radius.pill },
  typePill: { minHeight: 30, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceNeutral },
  detailCard: { overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  detailRow: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  detailValue: { fontWeight: '600' },
  warningBox: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  errorBox: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  actions: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actionRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  actionDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  destructive: { color: colors.danger },
  pressed: { opacity: 0.7 },
});
