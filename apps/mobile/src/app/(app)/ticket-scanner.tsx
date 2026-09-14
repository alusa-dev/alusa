import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from 'expo-camera';
import { router } from 'expo-router';
import { CheckCircleIcon, InformationCircleIcon, QrCodeIcon, XCircleIcon } from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { Button } from '@/components/primitives/Button';
import { TextField } from '@/components/primitives/TextField';
import { eventsService } from '@/features/events/services/events-service';
import type { MobileTicketEvent, VerifiedTicket } from '@/features/events/types/events';
import { formatEventDate } from '@/features/events/utils/format';
import { colors, radius, spacing } from '@/theme/tokens';

const barcodeTypes: BarcodeType[] = ['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc_a', 'upc_e'];

export default function TicketScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState('');
  const [resolvedEvent, setResolvedEvent] = useState<MobileTicketEvent | null>(null);
  const [ticket, setTicket] = useState<VerifiedTicket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const scanInFlight = useRef(false);

  const resetScan = useCallback(() => {
    scanInFlight.current = false;
    setTicket(null);
    setResolvedEvent(null);
    setError(null);
    setConfirmation(null);
    setManualCode('');
  }, []);

  const verifyCode = useCallback(async (rawCode: string) => {
    const normalizedCode = normalizeTicketCode(rawCode);
    if (!normalizedCode || scanInFlight.current) return;

    scanInFlight.current = true;
    Keyboard.dismiss();
    setManualCode(normalizedCode);
    setError(null);
    setConfirmation(null);
    setResolvedEvent(null);
    setTicket(null);
    setVerifying(true);

    try {
      const response = await eventsService.verifyTicket(normalizedCode);
      setResolvedEvent(response.event);
      setTicket(response.ticket);
    } catch (reason: unknown) {
      scanInFlight.current = false;
      setError(reason instanceof Error ? reason.message : 'Não foi possível validar este ingresso.');
    } finally {
      setVerifying(false);
    }
  }, []);

  const confirmEntry = useCallback(async () => {
    if (!ticket || ticket.status !== 'VALID' || confirming) return;

    setConfirming(true);
    setError(null);
    try {
      const response = await eventsService.verifyTicket(ticket.ticketCode, true);
      if ('ok' in response) {
        setResolvedEvent(response.event);
        setTicket(response.ticket);
        setConfirmation(response.alreadyUsed ? 'A entrada já havia sido registrada.' : 'Entrada registrada com sucesso.');
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível registrar a entrada.');
    } finally {
      setConfirming(false);
    }
  }, [confirming, ticket]);

  const cameraActive = Boolean(permission?.granted && !verifying && !ticket && !error);

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <PageHeader title="Ler ingresso" onBack={() => router.back()} />

      <View style={styles.introduction}>
        <AppText variant="small" tone="muted">
          Aponte a câmera para o QR code ou código de barras. O evento será identificado automaticamente.
        </AppText>
      </View>

      {permission?.granted ? (
        <View style={styles.cameraCard}>
          <View style={styles.cardHeading}>
            <View style={styles.iconCircle}><QrCodeIcon color={colors.brand} size={22} strokeWidth={1.8} /></View>
            <View style={styles.headingCopy}>
              <AppText variant="subheading" weight="medium">Leitura do ingresso</AppText>
              <AppText variant="small" tone="muted" numberOfLines={2}>O evento será identificado automaticamente.</AppText>
            </View>
          </View>

          <View style={styles.cameraFrame}>
            {cameraActive ? (
              <CameraView
                active
                facing="back"
                style={styles.camera}
                barcodeScannerSettings={{ barcodeTypes }}
                onBarcodeScanned={(result: BarcodeScanningResult) => void verifyCode(result.data)}
              />
            ) : (
              <View style={styles.cameraPaused}>
                {verifying ? <ActivityIndicator color={colors.brand} size="large" /> : <QrCodeIcon color={colors.inkSubtle} size={42} strokeWidth={1.5} />}
                <AppText variant="small" tone="muted">{verifying ? 'Validando ingresso...' : ticket ? 'Leitura concluída' : 'Aponte o ingresso para a moldura'}</AppText>
              </View>
            )}
            {cameraActive ? <View pointerEvents="none" style={styles.scanOverlay}><View style={styles.scanWindow} /></View> : null}
          </View>

          <AppText variant="small" tone="muted">Mantenha o código inteiro dentro da moldura para uma leitura mais rápida.</AppText>
        </View>
      ) : null}

      {permission && !permission.granted ? (
        <View style={styles.permissionCard}>
          <View style={styles.iconCircle}><InformationCircleIcon color={colors.brand} size={24} strokeWidth={1.8} /></View>
          <AppText variant="subheading" weight="medium">A câmera é necessária</AppText>
          <AppText variant="small" tone="muted">Permita o acesso à câmera para ler os ingressos. Você também pode informar o código manualmente logo abaixo.</AppText>
          <Button title="Permitir acesso à câmera" onPress={() => void requestPermission()} />
        </View>
      ) : null}

      {permission === null ? (
        <View style={styles.loadingCard} accessibilityLabel="Verificando acesso à câmera">
          <ActivityIndicator color={colors.brand} />
          <AppText variant="small" tone="muted">Verificando acesso à câmera...</AppText>
        </View>
      ) : null}

      {error ? <ErrorState title="Não foi possível validar" message={error} actionLabel="Ler novamente" onAction={resetScan} /> : null}
      {ticket ? <TicketResult event={resolvedEvent} ticket={ticket} confirmation={confirmation} confirming={confirming} onConfirm={confirmEntry} onReset={resetScan} /> : null}

      <View style={styles.manualCard}>
        <AppText variant="subheading" weight="medium">Digitar código</AppText>
        <AppText variant="small" tone="muted">Se a câmera não reconhecer o ingresso, informe o código impresso nele.</AppText>
        <TextField
          label="Código do ingresso"
          value={manualCode}
          onChangeText={setManualCode}
          placeholder="Digite ou cole o código"
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!verifying}
          leftIcon={<QrCodeIcon color={colors.inkMuted} size={21} strokeWidth={1.8} />}
          returnKeyType="done"
          onSubmitEditing={() => void verifyCode(manualCode)}
        />
        <Button title="Validar código" loading={verifying} disabled={!manualCode.trim()} onPress={() => void verifyCode(manualCode)} />
      </View>
    </Screen>
  );
}

function TicketResult({
  event,
  ticket,
  confirmation,
  confirming,
  onConfirm,
  onReset,
}: {
  event: MobileTicketEvent | null;
  ticket: VerifiedTicket;
  confirmation: string | null;
  confirming: boolean;
  onConfirm: () => void;
  onReset: () => void;
}) {
  const tone = getTicketTone(ticket.status);
  const buyerName = ticket.order?.buyerName ?? ticket.sale?.buyerName ?? 'Participante não identificado';
  const canCheckIn = ticket.status === 'VALID';

  return (
    <View style={styles.resultCard}>
      <View style={styles.resultHeader}>
        <View style={[styles.resultIcon, { backgroundColor: tone.background }]}>
          {canCheckIn ? <CheckCircleIcon color={tone.foreground} size={25} strokeWidth={1.8} /> : <XCircleIcon color={tone.foreground} size={25} strokeWidth={1.8} />}
        </View>
        <View style={styles.headingCopy}>
          <AppText variant="subheading" weight="medium">{canCheckIn ? 'Ingresso válido' : ticket.status === 'USED' ? 'Entrada já registrada' : 'Ingresso indisponível'}</AppText>
          <AppText variant="small" tone="muted">Confira os dados antes de continuar.</AppText>
        </View>
      </View>

      <View style={styles.resultRows}>
        <ResultRow label="Evento" value={event?.name ?? 'Evento identificado'} />
        <ResultRow label="Participante" value={buyerName} />
        <ResultRow label="Assento" value={ticket.seat ? `${ticket.seat.sectionName} · ${ticket.seat.seatLabel}` : 'Ingresso sem assento numerado'} />
        <ResultRow label="Código" value={ticket.ticketCode} />
        {ticket.usedAt ? <ResultRow label="Entrada registrada em" value={formatEventDate(ticket.usedAt)} /> : null}
      </View>

      {confirmation ? <AppText variant="small" tone="muted">{confirmation}</AppText> : null}
      {canCheckIn ? <Button title="Registrar entrada" loading={confirming} onPress={onConfirm} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Ler outro ingresso" onPress={onReset} style={({ pressed }) => [styles.secondaryAction, pressed ? styles.pressed : null]}>
        <AppText variant="small" weight="medium" style={styles.secondaryActionText}>Ler outro ingresso</AppText>
      </Pressable>
    </View>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.resultRow}><AppText variant="small" tone="muted">{label}</AppText><AppText numberOfLines={2} style={styles.resultValue}>{value}</AppText></View>;
}

function normalizeTicketCode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    for (const key of ['ticketCode', 'ticket', 'code']) {
      const parameter = url.searchParams.get(key)?.trim();
      if (parameter) return parameter;
    }

    const pathParts = url.pathname.split('/').filter(Boolean);
    const lastPathPart = pathParts.at(-1);
    if (lastPathPart && !['ingresso', 'ticket', 'tickets'].includes(lastPathPart.toLowerCase())) {
      return decodeURIComponent(lastPathPart).trim();
    }
  } catch {
    // O código pode ser um valor simples, sem URL.
  }

  return trimmed;
}

function getTicketTone(status: string) {
  if (status === 'VALID') return { foreground: colors.success, background: colors.accentSoft };
  if (status === 'USED') return { foreground: colors.brand, background: colors.brandSoft };
  return { foreground: colors.danger, background: colors.dangerSoft };
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: spacing['2xl'] },
  introduction: { paddingHorizontal: spacing.xs },
  loadingCard: { minHeight: 88, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  cameraCard: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  permissionCard: { gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headingCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  iconCircle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  cameraFrame: { height: 280, overflow: 'hidden', borderRadius: radius.lg, backgroundColor: colors.ink },
  camera: { flex: 1 },
  cameraPaused: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.surfaceSoft },
  scanOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  scanWindow: { width: '72%', aspectRatio: 1.35, borderWidth: 2, borderColor: colors.white, borderRadius: radius.lg },
  manualCard: { gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  resultCard: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resultIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  resultRows: { gap: spacing.md, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  resultRow: { gap: spacing.xs },
  resultValue: { fontWeight: '600' },
  secondaryAction: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  secondaryActionText: { color: colors.brand },
  pressed: { opacity: 0.76 },
});
