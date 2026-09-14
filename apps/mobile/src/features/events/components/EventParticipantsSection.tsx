import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRightIcon } from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { AppText } from '@/components/primitives/AppText';
import { eventsService } from '@/features/events/services/events-service';
import type { MobileEventParticipant } from '@/features/events/types/events';
import { colors, radius, spacing } from '@/theme/tokens';

import { EventParticipantList, EventParticipantListSkeleton } from './EventParticipantList';

const PREVIEW_PAGE_SIZE = 10;

export function EventParticipantsSection({
  eventId,
  refreshKey = 0,
  onParticipantPress,
  onViewAll,
}: {
  eventId: string;
  refreshKey?: number;
  onParticipantPress?: (_participant: MobileEventParticipant) => void;
  onViewAll?: () => void;
}) {
  const [participants, setParticipants] = useState<MobileEventParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadParticipants = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await eventsService.listEventParticipants(eventId, { page: 1, pageSize: PREVIEW_PAGE_SIZE });
      setParticipants(response.participants);
      setTotal(response.meta.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os alunos inscritos.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadParticipants();
  }, [loadParticipants, refreshKey]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <AppText variant="subheading" weight="medium">Alunos inscritos</AppText>
        {!loading && total !== null ? <AppText variant="small" tone="muted">{total}</AppText> : null}
      </View>

      {loading ? <EventParticipantListSkeleton count={3} /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadParticipants()} /> : null}
      {!loading && !error && participants.length === 0 ? <View style={styles.emptyCard}><AppText tone="muted">Nenhum aluno inscrito neste evento.</AppText></View> : null}
      {!loading && !error && participants.length > 0 ? <EventParticipantList participants={participants} onParticipantPress={onParticipantPress} /> : null}
      {!loading && !error && participants.length > 0 && total !== null && total > participants.length && onViewAll ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Ver todos os alunos inscritos" onPress={onViewAll} style={({ pressed }) => [styles.viewAllButton, pressed ? styles.pressed : null]}>
          <AppText variant="small" weight="medium" style={styles.viewAllText}>Ver todos os alunos</AppText>
          <ChevronRightIcon color={colors.brand} size={18} strokeWidth={1.8} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  emptyCard: { padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  viewAllButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  viewAllText: { color: colors.brand },
  pressed: { opacity: 0.74 },
});
