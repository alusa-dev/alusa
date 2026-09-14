import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRightIcon } from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { AppText } from '@/components/primitives/AppText';
import { eventsService } from '@/features/events/services/events-service';
import type { MobileEventFinancialEntry } from '@/features/events/types/events';
import { colors, radius, spacing } from '@/theme/tokens';

import { EventFinancialEntrySheet } from './EventFinancialEntrySheet';
import { EventFinancialEntryList, EventFinancialEntryListSkeleton } from './EventFinancialEntryList';

const PREVIEW_PAGE_SIZE = 10;

export function EventFinancialSection({
  eventId,
  enabled,
  canManage,
  refreshKey = 0,
  onChanged,
  onViewAll,
}: {
  eventId: string;
  enabled: boolean;
  canManage: boolean;
  refreshKey?: number;
  onChanged?: () => void | Promise<void>;
  onViewAll?: () => void;
}) {
  const [entries, setEntries] = useState<MobileEventFinancialEntry[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<MobileEventFinancialEntry | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  const loadEntries = useCallback(async (silent = false) => {
    if (!enabled) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await eventsService.listFinancialEntries(eventId, { page: 1, pageSize: PREVIEW_PAGE_SIZE });
      setEntries(response.entries);
      setTotal(response.meta.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os lançamentos.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [enabled, eventId]);

  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      setLoading(false);
      setTotal(null);
      return;
    }

    void loadEntries();
  }, [enabled, eventId, loadEntries, refreshKey]);

  const handleChanged = async () => {
    if (onChanged) {
      await onChanged();
      return;
    }
    await loadEntries(true);
  };

  if (!enabled) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <AppText variant="subheading" weight="medium">Lançamentos financeiros</AppText>
        {!loading && total !== null ? <AppText variant="small" tone="muted">{total} {total === 1 ? 'registro' : 'registros'}</AppText> : null}
      </View>

      {loading ? <EventFinancialEntryListSkeleton count={3} /> : null}
      {!loading && error ? (
        <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void loadEntries()} />
      ) : null}
      {!loading && !error && entries.length === 0 ? (
        <View style={styles.emptyCard}><AppText tone="muted">Nenhum lançamento registrado para este evento.</AppText></View>
      ) : null}
      {!loading && entries.length > 0 ? (
        <EventFinancialEntryList
          entries={entries}
          onEntryPress={(entry) => {
            setSelectedEntry(entry);
            setSheetVisible(true);
          }}
        />
      ) : null}
      {!loading && entries.length > 0 && total !== null && total > entries.length && onViewAll ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Ver todos os lançamentos" onPress={onViewAll} style={({ pressed }) => [styles.viewAllButton, pressed ? styles.pressed : null]}>
          <AppText variant="small" weight="medium" style={styles.viewAllText}>Ver todos os lançamentos</AppText>
          <ChevronRightIcon color={colors.brand} size={18} strokeWidth={1.8} />
        </Pressable>
      ) : null}

      <EventFinancialEntrySheet
        eventId={eventId}
        entry={selectedEntry}
        visible={sheetVisible}
        canManage={canManage}
        onClose={() => { setSheetVisible(false); setSelectedEntry(null); }}
        onChanged={handleChanged}
      />
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
