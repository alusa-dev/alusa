import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { ChevronRightIcon } from 'react-native-heroicons/outline';

import { Skeleton } from '@/components/feedback/Skeleton';
import { AppText } from '@/components/primitives/AppText';
import { StudentAvatar } from '@/features/students/components/StudentAvatar';
import type { MobileEventParticipant } from '@/features/events/types/events';
import { colors, radius, spacing } from '@/theme/tokens';

export function EventParticipantList({
  participants,
  onParticipantPress,
}: {
  participants: MobileEventParticipant[];
  onParticipantPress?: (_participant: MobileEventParticipant) => void;
}) {
  return (
    <View style={styles.list}>
      {participants.map((participant) => (
        <EventParticipantRow
          key={participant.id}
          participant={participant}
          onPress={onParticipantPress ? () => onParticipantPress(participant) : undefined}
        />
      ))}
    </View>
  );
}

export function EventParticipantRow({
  participant,
  onPress,
}: {
  participant: MobileEventParticipant;
  onPress?: () => void;
}) {
  const statusTone = getParticipantStatusTone(participant.financialStatus);
  const name = participant.displayName || participant.aluno?.nome || 'Aluno não identificado';
  const secondaryText = participant.turma?.nome ?? 'Aluno inscrito no evento';
  const interactive = Boolean(onPress);

  return (
    <Pressable
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityLabel={interactive ? `Abrir detalhes de ${name}` : name}
      disabled={!interactive}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <StudentAvatar name={name} photo={participant.aluno?.foto ?? null} size={44} />
      <View style={styles.copy}>
        <AppText weight="medium" numberOfLines={1}>{name}</AppText>
        <View style={styles.metaLine}>
          <View style={[styles.statusDot, { backgroundColor: statusTone.foreground }]} />
          <AppText variant="small" tone="muted" numberOfLines={1} style={styles.metaText}>
            {secondaryText} · {participantFinancialStatusLabel(participant.financialStatus)}
          </AppText>
        </View>
      </View>
      {interactive ? <ChevronRightIcon color={colors.inkMuted} size={20} strokeWidth={1.8} /> : null}
    </Pressable>
  );
}

export function EventParticipantListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View style={styles.list} accessibilityLabel="Carregando alunos inscritos">
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.row}>
          <Skeleton width={44} height={44} radius={radius.pill} />
          <View style={styles.skeletonCopy}>
            <Skeleton width={`${58 + (index % 3) * 9}%`} height={17} />
            <Skeleton width={`${44 + (index % 2) * 14}%`} height={13} />
          </View>
          <Skeleton width={18} height={18} radius={radius.pill} />
        </View>
      ))}
    </View>
  );
}

export function EventParticipantListFooter({
  hasMore,
  loading,
  error,
  onRetry,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore?: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator color={colors.brand} />
        <AppText variant="small" tone="muted">Carregando mais alunos...</AppText>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.footer}>
        <AppText variant="small" tone="muted" numberOfLines={2}>{error}</AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="Tentar carregar mais alunos" onPress={onRetry} hitSlop={8}>
          <AppText variant="small" weight="medium" style={styles.footerAction}>Tentar novamente</AppText>
        </Pressable>
      </View>
    );
  }

  if (hasMore && onLoadMore) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Carregar mais alunos" onPress={onLoadMore} hitSlop={8} style={({ pressed }) => [styles.loadMore, pressed ? styles.pressed : null]}>
        <AppText variant="small" weight="medium" style={styles.footerAction}>Carregar mais alunos</AppText>
      </Pressable>
    );
  }

  if (!hasMore) return <AppText variant="small" tone="muted" style={styles.endMessage}>Fim da lista</AppText>;
  return null;
}

export function participantFinancialStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ISENTO: 'Isento',
    PENDENTE: 'Pendente',
    PARCIAL: 'Parcial',
    EM_DIA: 'Em dia',
    ATRASADO: 'Atrasado',
    QUITADO: 'Quitado',
    ESTORNADO: 'Estornado',
    CANCELADO: 'Cancelado',
  };
  return labels[status] ?? 'Pendente';
}

function getParticipantStatusTone(status: string) {
  if (status === 'QUITADO' || status === 'EM_DIA') return { foreground: colors.success };
  if (status === 'CANCELADO' || status === 'ESTORNADO') return { foreground: colors.inkSubtle };
  if (status === 'ATRASADO') return { foreground: colors.danger };
  if (status === 'ISENTO') return { foreground: colors.inkMuted };
  return { foreground: colors.warning };
}

const styles = StyleSheet.create({
  list: { overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minWidth: 0 },
  metaText: { flex: 1 },
  statusDot: { width: 7, height: 7, borderRadius: radius.pill },
  skeletonCopy: { flex: 1, gap: spacing.sm },
  footer: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  footerAction: { color: colors.brand },
  loadMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  endMessage: { textAlign: 'center', paddingVertical: spacing.lg },
  pressed: { opacity: 0.74 },
});
