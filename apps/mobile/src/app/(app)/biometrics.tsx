import { useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';

import { PageHeader } from '@/components/layout/PageHeader';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';
import { getBiometricAvailability } from '@/lib/biometrics/local-authentication';
import { disableBiometrics, enableBiometrics } from '@/features/session/services/session-service';
import { useSession } from '@/features/session/hooks/use-session';

export default function BiometricsScreen() {
  const { session, savedProfile } = useSession();
  const [loading, setLoading] = useState(false);
  const biometricEnabled = Boolean(savedProfile?.biometricEnabled);

  async function handleToggle(nextValue: boolean) {
    if (!session || loading) return;

    setLoading(true);
    try {
      if (!nextValue) {
        await disableBiometrics(session);
        return;
      }

      const availability = await getBiometricAvailability();
      if (!availability.available) {
        Alert.alert(
          'Face ID indisponível',
          availability.hasHardware
            ? 'Cadastre o Face ID neste aparelho para ativar esta opção.'
            : 'Este aparelho não possui suporte ao Face ID.',
        );
        return;
      }

      const enabled = await enableBiometrics(session);
      if (!enabled) {
        Alert.alert('Face ID não ativado', 'Você pode tentar novamente quando quiser.');
      }
    } catch {
      Alert.alert('Não foi possível ativar o Face ID', 'Tente novamente em alguns instantes.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen backgroundColor={colors.surface} style={styles.screen}>
      <PageHeader title="Biometria" onBack={() => router.back()} />

      <View style={styles.optionCard}>
        <AppText variant="body" weight="medium">Ativar Face ID</AppText>
        <View style={styles.switchSlot}>
          <Switch
            accessibilityLabel="Ativar Face ID"
            value={biometricEnabled}
            onValueChange={(value) => void handleToggle(value)}
            disabled={loading}
            trackColor={{ false: colors.border, true: colors.brandSoft }}
            thumbColor={biometricEnabled ? colors.brand : colors.inkSubtle}
            ios_backgroundColor={colors.border}
          />
        </View>
      </View>

      <AppText variant="small" tone="muted" style={styles.info}>
        Com o Face ID ativado, você entra na Alusa com mais rapidez e segurança. Sua biometria permanece protegida no aparelho e não é compartilhada com a Alusa.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.xl,
    paddingBottom: spacing.xl,
  },
  optionCard: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceNeutral,
  },
  switchSlot: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    marginTop: -spacing.md,
    lineHeight: 19,
  },
});
