import { useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { BrandMark } from '@/components/layout/BrandMark';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { Button } from '@/components/primitives/Button';
import { clearSession } from '@/features/session/services/session-service';
import { useSession } from '@/features/session/hooks/use-session';
import { colors, radius, spacing } from '@/theme/tokens';

export default function AccountScreen() {
  const queryClient = useQueryClient();
  const { session, activeContaId } = useSession();

  return (
    <Screen style={styles.screen}>
      <BrandMark />
      <View style={styles.card}>
        <AppText variant="heading" weight="bold">
          Perfil de acesso
        </AppText>
        <Info label="Usuário" value={session?.user.name ?? session?.user.email ?? 'Não informado'} />
        <Info label="E-mail" value={session?.user.email ?? 'Não informado'} />
        <Info label="Perfil" value={session?.user.role ?? 'Definido pelo backend'} />
        <Info label="contaId ativo" value={activeContaId ?? 'Aguardando contrato multi-conta'} />
      </View>
      <Button title="Sair da conta" variant="primary" onPress={() => clearSession(queryClient)} />
    </Screen>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <AppText variant="tiny" tone="muted" weight="bold">
        {label.toUpperCase()}
      </AppText>
      <AppText weight="medium">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.xl,
    paddingBottom: 110,
  },
  card: {
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: {
    gap: spacing.xs,
  },
});
