import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from 'expo-camera';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeftIcon, BoltIcon, QrCodeIcon } from 'react-native-heroicons/outline';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';

import { AppText } from '@/components/primitives/AppText';
import { Button } from '@/components/primitives/Button';
import { eventsService } from '@/features/events/services/events-service';
import type { MobileTicketEvent, VerifiedTicket } from '@/features/events/types/events';
import { colors, radius, spacing } from '@/theme/tokens';

import { UniversalQrResultPanel } from '@/features/qr-scanner/components/UniversalQrResultPanel';
import type { UniversalQrResolution } from '@/features/qr-scanner/types/universal-qr';
import { isPossibleEventTicketCode, resolveUniversalQr } from '@/features/qr-scanner/utils/resolve-universal-qr';

const QR_BARCODE_TYPES: BarcodeType[] = ['qr'];

type ScannerMode = 'scanning' | 'processing' | 'result';

export default function UniversalQrScannerScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [mode, setMode] = useState<ScannerMode>('scanning');
  const [resolution, setResolution] = useState<UniversalQrResolution | null>(null);
  const [ticket, setTicket] = useState<VerifiedTicket | null>(null);
  const [ticketEvent, setTicketEvent] = useState<MobileTicketEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const scanInFlight = useRef(false);

  const frameSize = useMemo(() => Math.min(Math.max(width - spacing['3xl'] * 2, 232), 320), [width]);
  const scanWindowRadius = Math.min(Math.max(frameSize * 0.14, 40), 52);
  const frameTop = useMemo(
    () => Math.max(insets.top + 128, Math.round((height - frameSize) / 2 - 18)),
    [frameSize, height, insets.top],
  );

  const resetScan = useCallback(() => {
    scanInFlight.current = false;
    setMode('scanning');
    setResolution(null);
    setTicket(null);
    setTicketEvent(null);
    setError(null);
    setConfirmation(null);
    setConfirming(false);
  }, []);

  const handleBarcodeScanned = useCallback(async (result: BarcodeScanningResult) => {
    const rawValue = result.data?.trim();
    if (!rawValue || mode !== 'scanning' || scanInFlight.current) return;

    scanInFlight.current = true;
    setMode('processing');
    setResolution(null);
    setTicket(null);
    setTicketEvent(null);
    setError(null);
    setConfirmation(null);

    const classified = resolveUniversalQr(rawValue);
    const isTicketCandidate = classified.kind === 'EVENT_TICKET' || isPossibleEventTicketCode(rawValue);

    if (!isTicketCandidate) {
      setResolution(classified);
      setMode('result');
      scanInFlight.current = false;
      return;
    }

    const ticketCode = classified.target?.type === 'EVENT_TICKET' ? classified.target.ticketCode : rawValue;
    const ticketResolution: UniversalQrResolution = {
      kind: 'EVENT_TICKET',
      title: 'Ingresso identificado',
      message: 'Confira os dados do evento antes de registrar a entrada.',
      displayValue: classified.displayValue,
      target: { type: 'EVENT_TICKET', ticketCode },
    };

    try {
      const response = await eventsService.verifyTicket(ticketCode);
      setResolution(ticketResolution);
      setTicketEvent(response.event);
      setTicket(response.ticket);
    } catch {
      setResolution(ticketResolution);
      setError('Não foi possível validar este ingresso agora. Tente novamente.');
    } finally {
      setMode('result');
      scanInFlight.current = false;
    }
  }, [mode]);

  const confirmEntry = useCallback(async () => {
    if (!ticket || ticket.status !== 'VALID' || confirming) return;

    setConfirming(true);
    setError(null);
    try {
      const response = await eventsService.verifyTicket(ticket.ticketCode, true);
      if ('ok' in response) {
        setTicketEvent(response.event);
        setTicket(response.ticket);
        setConfirmation(response.alreadyUsed ? 'A entrada já havia sido registrada.' : 'Entrada registrada com sucesso.');
      }
    } catch {
      setError('Não foi possível registrar a entrada agora. Tente novamente.');
    } finally {
      setConfirming(false);
    }
  }, [confirming, ticket]);

  const openCharge = useCallback(() => {
    const target = resolution?.target;
    if (target?.type !== 'CHARGE') return;

    router.push({ pathname: '/(app)/billing/[chargeId]', params: { chargeId: target.chargeId } });
  }, [resolution]);

  const cameraActive = permission?.granted === true && mode === 'scanning';

  return (
    <View style={styles.screen}>
      <StatusBar style={mode === 'result' ? 'dark' : 'light'} />

      {permission?.granted && mode !== 'result' ? (
        <CameraView
          active={cameraActive}
          facing="back"
          enableTorch={torchEnabled && cameraActive}
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: QR_BARCODE_TYPES }}
          onBarcodeScanned={handleBarcodeScanned}
        />
      ) : null}

      {permission?.granted && mode !== 'result' ? (
        <Svg pointerEvents="none" width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            <Mask
              id="universal-qr-scan-cutout"
              maskUnits="userSpaceOnUse"
              maskContentUnits="userSpaceOnUse"
              maskType="luminance"
            >
              <Rect x={0} y={0} width={width} height={height} fill={colors.white} />
              <Rect
                x={(width - frameSize) / 2}
                y={frameTop}
                width={frameSize}
                height={frameSize}
                rx={scanWindowRadius}
                ry={scanWindowRadius}
                fill="#000000"
              />
            </Mask>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill="rgba(0, 0, 0, 0.62)" mask="url(#universal-qr-scan-cutout)" />
        </Svg>
      ) : null}

      {mode !== 'result' ? (
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sair do leitor de QR Code"
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.headerAction, pressed ? styles.pressed : null]}
          >
            <ArrowLeftIcon color={colors.white} size={27} strokeWidth={1.8} />
          </Pressable>
          <AppText variant="subheading" tone="inverse" weight="medium" style={styles.headerTitle}>Ler QR Code</AppText>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={torchEnabled ? 'Desligar flash' : 'Ligar flash'}
            accessibilityState={{ checked: torchEnabled }}
            hitSlop={8}
            onPress={() => setTorchEnabled((current) => !current)}
            style={({ pressed }) => [styles.headerAction, torchEnabled ? styles.headerActionActive : null, pressed ? styles.pressed : null]}
          >
            <BoltIcon color={torchEnabled ? colors.brand : colors.white} size={25} strokeWidth={1.8} />
          </Pressable>
        </View>
      ) : null}

      {mode === 'scanning' && permission?.granted ? (
        <View pointerEvents="none" style={[styles.hint, { bottom: Math.max(insets.bottom + spacing['3xl'], 72) }]}>
          <AppText variant="body" tone="inverse" weight="medium" style={styles.hintTitle}>Aponte para um QR Code</AppText>
        </View>
      ) : null}

      {mode === 'processing' ? (
        <View style={[styles.processing, { top: frameTop + frameSize / 2 - 34, left: (width - frameSize) / 2, width: frameSize }]}>
          <ActivityIndicator color={colors.white} size="large" />
          <AppText variant="small" tone="inverse" weight="medium">Identificando...</AppText>
        </View>
      ) : null}

      {permission === null ? (
        <View style={styles.permissionState}>
          <ActivityIndicator color={colors.white} size="large" />
          <AppText variant="small" tone="inverse" style={styles.permissionText}>Verificando acesso à câmera...</AppText>
        </View>
      ) : null}

      {permission && !permission.granted ? (
        <View style={styles.permissionState}>
          <View style={styles.permissionIcon}><QrCodeIcon color={colors.white} size={34} strokeWidth={1.6} /></View>
          <AppText variant="heading" tone="inverse" weight="medium" style={styles.permissionTitle}>Permita o acesso à câmera</AppText>
          <AppText variant="small" tone="inverse" style={styles.permissionText}>Precisamos da câmera para identificar QR Codes de pagamentos, ingressos e fluxos da Alusa.</AppText>
          <Button title="Permitir câmera" onPress={() => void requestPermission()} />
        </View>
      ) : null}

      {mode === 'result' && resolution ? (
        <UniversalQrResultPanel
          resolution={resolution}
          ticket={ticket}
          event={ticketEvent}
          error={error}
          confirmation={confirmation}
          confirming={confirming}
          presentation="page"
          onBack={resetScan}
          onPrimary={resolution.target?.type === 'CHARGE' ? openCharge : undefined}
          onConfirmTicket={() => void confirmEntry()}
          onReset={resetScan}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#070508',
  },
  header: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
  },
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  headerActionActive: {
    backgroundColor: colors.white,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  hint: {
    position: 'absolute',
    right: spacing.xl,
    left: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  hintTitle: {
    textAlign: 'center',
  },
  processing: {
    position: 'absolute',
    alignItems: 'center',
    gap: spacing.sm,
  },
  permissionState: {
    position: 'absolute',
    top: 0,
    right: spacing.xl,
    bottom: 0,
    left: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  permissionIcon: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  permissionTitle: {
    textAlign: 'center',
  },
  permissionText: {
    maxWidth: 330,
    color: 'rgba(255, 255, 255, 0.78)',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.72,
  },
});
