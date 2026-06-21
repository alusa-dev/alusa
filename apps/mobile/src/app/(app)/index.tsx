import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { BrandMark } from '@/components/layout/BrandMark';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { colors, radius, shadows, spacing } from '@/theme/tokens';
import { useSession } from '@/features/session/hooks/use-session';

export default function AppHomeScreen() {
  const { session, activeContaId } = useSession();
  const conta = session?.user.contas?.find((item) => item.id === activeContaId);
  const contaNome = conta?.nome ?? session?.user.contaId ?? 'Conta confirmada pelo backend';

  return (
    <Screen scroll style={styles.screen}>
      <View style={styles.header}>
        <BrandMark />
        <View style={styles.statusPill}>
          <AppText variant="tiny" weight="bold">
            Sessão segura
          </AppText>
        </View>
      </View>

      <View style={styles.heroCard}>
        <AppText tone="inverse" variant="small" weight="medium">
          Olá{session?.user.name ? `, ${session.user.name}` : ''}
        </AppText>
        <AppText tone="inverse" variant="heading" weight="bold">
          Seu app Alusa está pronto para receber os módulos da escola.
        </AppText>
        <View style={styles.tenantBox}>
          <AppText variant="tiny" tone="muted" weight="bold">
            CONTA ATIVA
          </AppText>
          <AppText weight="bold">{contaNome}</AppText>
          <AppText variant="small" tone="muted">
            A autorização final continua sendo validada pelo servidor da Alusa.
          </AppText>
        </View>
      </View>

      <EmptyState
        title="Módulos serão carregados por contrato"
        message="Financeiro, agenda, turmas e alunos entram nas próximas fases, usando APIs tenant-scoped e permissões do backend."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.xl,
    paddingBottom: 110,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusPill: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  heroCard: {
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.brand,
    ...shadows.card,
  },
  tenantBox: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
});
