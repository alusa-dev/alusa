import { Pressable, StyleSheet, View } from 'react-native';
import { ArrowLeftIcon, CheckCircleIcon, InformationCircleIcon, XCircleIcon } from 'react-native-heroicons/outline';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/primitives/AppText';
import { Button } from '@/components/primitives/Button';
import type { MobileTicketEvent, VerifiedTicket } from '@/features/events/types/events';
import { colors, radius, spacing } from '@/theme/tokens';

import type { UniversalQrResolution } from '../types/universal-qr';

type UniversalQrResultPanelProps = {
  resolution: UniversalQrResolution;
  ticket?: VerifiedTicket | null;
  event?: MobileTicketEvent | null;
  error?: string | null;
  confirmation?: string | null;
  confirming?: boolean;
  presentation?: 'page' | 'sheet';
  onBack?: () => void;
  onPrimary?: () => void;
  onConfirmTicket?: () => void;
  onReset: () => void;
};

export function UniversalQrResultPanel({
  resolution,
  ticket = null,
  event = null,
  error = null,
  confirmation = null,
  confirming = false,
  presentation = 'page',
  onBack,
  onPrimary,
  onConfirmTicket,
  onReset,
}: UniversalQrResultPanelProps) {
  const insets = useSafeAreaInsets();
  const view = getResultView(resolution, ticket, error);
  const Icon = view.icon;
  const canConfirmTicket = ticket?.status === 'VALID' && onConfirmTicket;
  const isPage = presentation === 'page';

  return (
    <View style={[isPage ? styles.page : styles.panel, isPage ? { paddingTop: insets.top + spacing.sm } : null, { paddingBottom: Math.max(insets.bottom + spacing.md, spacing.xl) }]}>
      {isPage ? (
        <View style={styles.pageHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar para a leitura"
            hitSlop={8}
            onPress={onBack ?? onReset}
            style={({ pressed }) => [styles.pageBackButton, pressed ? styles.pressed : null]}
          >
            <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
          </Pressable>
          <AppText variant="subheading" weight="medium" style={styles.pageTitle}>Resultado da leitura</AppText>
          <View style={styles.pageHeaderSpacer} />
        </View>
      ) : <View style={styles.handle} />}
      <View style={[styles.iconCircle, { backgroundColor: view.iconBackground }]}>
        <Icon color={view.iconColor} size={26} strokeWidth={1.8} />
      </View>
      <AppText variant="heading" weight="medium" style={styles.title}>{view.title}</AppText>
      <AppText variant="small" tone="muted" style={styles.message}>{view.message}</AppText>

      {ticket && event ? (
        <View style={styles.detailsCard}>
          <DetailRow label="Evento" value={event.name} />
          <DetailRow label="Participante" value={ticket.order?.buyerName ?? ticket.sale?.buyerName ?? 'Não identificado'} />
          {ticket.seat ? <DetailRow label="Assento" value={`${ticket.seat.sectionName} · ${ticket.seat.seatLabel}`} /> : null}
          <DetailRow label="Código" value={ticket.ticketCode} />
        </View>
      ) : null}

      {resolution.displayValue && !ticket ? (
        <View style={styles.valueBox}>
          <AppText variant="tiny" tone="muted">Código identificado</AppText>
          <AppText variant="small" weight="medium" numberOfLines={1}>{resolution.displayValue}</AppText>
        </View>
      ) : null}

      {confirmation ? <AppText variant="small" style={styles.confirmation}>{confirmation}</AppText> : null}
      {error && ticket ? <AppText variant="small" tone="danger" style={styles.errorText}>{error}</AppText> : null}

      {canConfirmTicket ? <Button title="Registrar entrada" loading={confirming} onPress={onConfirmTicket} /> : null}
      {resolution.target?.type === 'CHARGE' && onPrimary ? <Button title="Abrir cobrança" onPress={onPrimary} /> : null}

      <Pressable accessibilityRole="button" accessibilityLabel="Ler outro QR Code" onPress={onReset} style={({ pressed }) => [styles.resetButton, pressed ? styles.pressed : null]}>
        <AppText variant="small" weight="medium" style={styles.resetText}>Ler outro QR Code</AppText>
      </Pressable>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <AppText variant="tiny" tone="muted">{label}</AppText>
      <AppText variant="small" numberOfLines={2} style={styles.detailValue}>{value}</AppText>
    </View>
  );
}

function getResultView(resolution: UniversalQrResolution, ticket: VerifiedTicket | null, error: string | null) {
  if (resolution.kind === 'EVENT_TICKET' && ticket) {
    if (ticket.status === 'VALID') {
      return {
        title: 'Ingresso válido',
        message: 'Confira os dados antes de registrar a entrada.',
        icon: CheckCircleIcon,
        iconColor: colors.success,
        iconBackground: colors.accentSoft,
      };
    }
    if (ticket.status === 'USED') {
      return {
        title: 'Entrada já registrada',
        message: 'Este ingresso já foi utilizado anteriormente.',
        icon: InformationCircleIcon,
        iconColor: colors.brand,
        iconBackground: colors.brandSoft,
      };
    }
    return {
      title: 'Ingresso indisponível',
      message: 'Este ingresso não pode ser utilizado.',
      icon: XCircleIcon,
      iconColor: colors.danger,
      iconBackground: colors.dangerSoft,
    };
  }

  if (error) {
    return {
      title: resolution.kind === 'EVENT_TICKET' ? 'Ingresso não encontrado' : 'Não foi possível concluir',
      message: 'Não conseguimos confirmar este código agora. Tente novamente.',
      icon: XCircleIcon,
      iconColor: colors.danger,
      iconBackground: colors.dangerSoft,
    };
  }

  if (resolution.kind === 'UNKNOWN') {
    return {
      title: resolution.title,
      message: resolution.message,
      icon: XCircleIcon,
      iconColor: colors.danger,
      iconBackground: colors.dangerSoft,
    };
  }

  return {
    title: resolution.title,
    message: resolution.message,
    icon: InformationCircleIcon,
    iconColor: resolution.kind === 'PIX' ? colors.info : colors.brand,
    iconBackground: resolution.kind === 'PIX' ? colors.surfaceSoft : colors.brandSoft,
  };
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  page: {
    flex: 1,
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
  },
  pageHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageBackButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: {
    flex: 1,
    textAlign: 'center',
  },
  pageHeaderSpacer: {
    width: 44,
    height: 44,
  },
  handle: { alignSelf: 'center', width: 42, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  iconCircle: { alignSelf: 'center', width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  title: { textAlign: 'center' },
  message: { textAlign: 'center' },
  detailsCard: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  detailRow: { gap: spacing.xs },
  detailValue: { flexShrink: 1 },
  valueBox: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceNeutral },
  confirmation: { color: colors.success, textAlign: 'center' },
  errorText: { textAlign: 'center' },
  resetButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  resetText: { color: colors.brand },
  pressed: { opacity: 0.74 },
});
