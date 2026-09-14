import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CheckCircleIcon, TrashIcon, XMarkIcon } from 'react-native-heroicons/outline';

import { BottomSheet } from '@/components/overlays/BottomSheet';
import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

import type { MobileNotificationsController } from '../hooks/use-mobile-notifications';
import type { MobileNotificationItem, MobileNotificationSeverity } from '../types/notifications';

export function NotificationsSheet({ visible, onClose, notifications }: { visible: boolean; onClose: () => void; notifications: MobileNotificationsController }) {
  const hasItems = notifications.items.length > 0;
  const [revealedId, setRevealedId] = useState<string | null>(null);

  function confirmRemove(item: MobileNotificationItem) {
    Alert.alert('Excluir notificação?', 'Esta notificação será removida apenas da sua caixa de entrada.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: () => void notifications.remove(item.id) },
    ]);
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeight="84%" accessibilityLabel="Notificações">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText variant="heading" weight="medium">Notificações</AppText>
          <AppText variant="small" tone="muted">Atualizações internas da operação</AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Fechar notificações" hitSlop={8} onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed ? styles.pressed : null]}>
          <XMarkIcon color={colors.ink} size={24} strokeWidth={1.8} />
        </Pressable>
      </View>

      {notifications.loading ? <LoadingContent /> : null}

      {!notifications.loading && notifications.error ? (
        <View style={styles.feedbackCard}>
          <AppText variant="subheading" weight="medium">Não foi possível carregar</AppText>
          <AppText variant="small" tone="muted">{notifications.error}</AppText>
          <Pressable accessibilityRole="button" onPress={() => void notifications.reload()} style={({ pressed }) => [styles.retryButton, pressed ? styles.pressed : null]}>
            <AppText variant="small" weight="medium" style={styles.brandText}>Tentar novamente</AppText>
          </Pressable>
        </View>
      ) : null}

      {!notifications.loading && !notifications.error && !hasItems ? <EmptyContent /> : null}

      {!notifications.loading && !notifications.error && hasItems ? (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {notifications.items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              revealed={revealedId === item.id}
              onReveal={() => setRevealedId(item.id)}
              onClose={() => setRevealedId(null)}
              onRead={() => { setRevealedId(null); void notifications.markAsRead(item.id); }}
              onRemove={() => { setRevealedId(null); confirmRemove(item); }}
            />
          ))}
        </ScrollView>
      ) : null}

      {hasItems ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Marcar todas as notificações como lidas"
          disabled={notifications.submitting || notifications.unreadCount === 0}
          onPress={() => void notifications.markAllAsRead()}
          style={({ pressed }) => [styles.markAllButton, notifications.unreadCount === 0 ? styles.disabled : null, pressed ? styles.pressed : null]}
        >
          <AppText variant="small" weight="medium" style={styles.brandText}>
            {notifications.unreadCount > 0 ? `Marcar todas como lidas · ${notifications.unreadCount}` : 'Todas as notificações estão lidas'}
          </AppText>
        </Pressable>
      ) : null}
    </BottomSheet>
  );
}

function LoadingContent() {
  return (
    <View style={styles.loading} accessibilityLabel="Carregando notificações">
      <ActivityIndicator color={colors.brand} />
      <AppText variant="small" tone="muted">Carregando notificações...</AppText>
    </View>
  );
}

function EmptyContent() {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><CheckCircleIcon color={colors.inkMuted} size={42} strokeWidth={1.6} /></View>
      <AppText variant="heading" weight="medium" style={styles.emptyTitle}>Tudo certo por aqui</AppText>
      <AppText variant="small" tone="muted" style={styles.emptyMessage}>Se tiver alguma notificação, vamos avisar.</AppText>
    </View>
  );
}

const DELETE_ACTION_WIDTH = 72;

function NotificationRow({ item, revealed, onReveal, onClose, onRead, onRemove }: { item: MobileNotificationItem; revealed: boolean; onReveal: () => void; onClose: () => void; onRead: () => void; onRemove: () => void }) {
  const unread = !item.readAt && !item.archivedAt;
  const severity = getSeverityMeta(item.severity);
  const translateX = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: (_, gesture) => translateX.setValue(Math.max(-DELETE_ACTION_WIDTH, Math.min(0, gesture.dx))),
    onPanResponderRelease: (_, gesture) => {
      const shouldReveal = gesture.dx < -(DELETE_ACTION_WIDTH * 0.45) || gesture.vx < -0.5;
      Animated.spring(translateX, { toValue: shouldReveal ? -DELETE_ACTION_WIDTH : 0, useNativeDriver: true, bounciness: 5 }).start();
      if (shouldReveal) onReveal(); else onClose();
    },
  }), [onClose, onReveal, translateX]);

  useEffect(() => {
    Animated.spring(translateX, { toValue: revealed ? -DELETE_ACTION_WIDTH : 0, useNativeDriver: true, bounciness: 5 }).start();
  }, [revealed, translateX]);

  return (
    <View style={styles.swipeRow}>
      <View style={styles.deleteAction}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Excluir ${item.title}`} onPress={onRemove} style={({ pressed }) => [styles.deleteButton, pressed ? styles.pressed : null]}>
          <TrashIcon color={colors.danger} size={23} strokeWidth={1.7} />
        </Pressable>
      </View>
      <Animated.View style={[styles.row, unread ? styles.rowUnread : null, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        <View style={[styles.severityBar, { backgroundColor: severity.color }]} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}${unread ? ', não lida' : ''}`} onPress={onRead} style={({ pressed }) => [styles.rowPressable, pressed ? styles.pressed : null]}>
          <View style={styles.rowHeader}>
            <AppText variant="small" weight="medium" numberOfLines={2} style={styles.rowTitle}>{item.title}</AppText>
            {unread ? <View style={styles.unreadDot} accessibilityLabel="Não lida" /> : null}
          </View>
          <AppText variant="small" tone="muted" numberOfLines={3}>{formatMessage(item.message)}</AppText>
          <AppText variant="tiny" tone="subtle">{formatDateTime(item.triggeredAt)}</AppText>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function getSeverityMeta(severity: MobileNotificationSeverity) {
  switch (severity) {
    case 'SUCCESS': return { color: colors.success };
    case 'WARNING': return { color: colors.warning };
    case 'CRITICAL': return { color: colors.danger };
    default: return { color: colors.info };
  }
}

function formatMessage(message: string) {
  return message.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim() || 'Atualização disponível.';
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  closeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  loading: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  empty: { minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  emptyIcon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surfaceNeutral },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center' },
  emptyMessage: { textAlign: 'center' },
  feedbackCard: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.dangerSoft },
  retryButton: { alignSelf: 'flex-start', paddingVertical: spacing.sm },
  list: { flexShrink: 1 },
  listContent: { gap: spacing.sm, paddingBottom: spacing.xs },
  swipeRow: { overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  deleteAction: { ...StyleSheet.absoluteFill, alignItems: 'flex-end', justifyContent: 'center', paddingRight: spacing.md, backgroundColor: colors.dangerSoft },
  deleteButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  rowUnread: { backgroundColor: colors.surfaceRaised },
  severityBar: { width: 3, height: 70, marginTop: 2, flexShrink: 0, borderRadius: radius.pill },
  rowPressable: { flex: 1, minWidth: 0, gap: spacing.xs },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowTitle: { flex: 1 },
  unreadDot: { width: 8, height: 8, marginTop: 4, borderRadius: radius.pill, backgroundColor: colors.brand },
  markAllButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  brandText: { color: colors.brand },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.76 },
});
