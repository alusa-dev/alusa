import { useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  ArrowRightIcon,
  BanknotesIcon,
  BellIcon,
  CalculatorIcon,
  CalendarDaysIcon,
  ClipboardDocumentListIcon,
  CreditCardIcon,
  DocumentChartBarIcon,
  MagnifyingGlassIcon,
  QrCodeIcon,
  QuestionMarkCircleIcon,
  UserCircleIcon,
  UserPlusIcon,
  UserGroupIcon,
} from 'react-native-heroicons/outline';
import { router } from 'expo-router';

import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { mobileEnv } from '@/config/env';
import { NotificationsSheet } from '@/features/notifications/components/NotificationsSheet';
import { useMobileNotifications } from '@/features/notifications/hooks/use-mobile-notifications';
import { useSession } from '@/features/session/hooks/use-session';
import { resolveProfilePhotoUri } from '@/features/session/utils/profile-photo';
import { colors, radius, spacing } from '@/theme/tokens';

const moduleCards = [
  { title: 'Matrículas', description: 'Acompanhe novos acessos e rematrículas.' },
  { title: 'Cobranças', description: 'Consulte pendências e próximos vencimentos.' },
  { title: 'Contratos', description: 'Tenha os contratos da escola por perto.' },
] as const;

const quickActions = [
  { label: 'Alunos', icon: UserGroupIcon },
  { label: 'Agenda', icon: CalendarDaysIcon },
  { label: 'Avisos', icon: BellIcon },
] as const;

const quickActionCards = [
  { label: 'Criar cobrança', icon: BanknotesIcon },
  { label: 'Extrato financeiro', icon: DocumentChartBarIcon },
  { label: 'Simular venda', icon: CalculatorIcon },
  { label: 'Nova matrícula', icon: ClipboardDocumentListIcon },
  { label: 'Registrar pagamento', icon: CreditCardIcon },
  { label: 'Adicionar aluno', icon: UserPlusIcon },
] as const;

export default function AppHomeScreen() {
  const { width } = useWindowDimensions();
  const { session } = useSession();
  const moduleRail = useRef<ScrollView>(null);
  const [moduleIndex, setModuleIndex] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifications = useMobileNotifications(notificationsOpen);
  const { unreadCount } = notifications;

  const userName = session?.user.name ?? 'Usuário';
  const profilePhotoUri = resolveProfilePhotoUri(session?.user.foto, mobileEnv.apiUrl);
  const moduleWidth = useMemo(() => Math.min(width - spacing.xl * 2, 330), [width]);

  function handleModuleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / (moduleWidth + spacing.md));
    setModuleIndex(Math.max(0, Math.min(nextIndex, moduleCards.length - 1)));
  }

  return (
    <>
      <Screen scroll backgroundColor={colors.surface} style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable
          style={styles.profileButton}
          accessibilityRole="button"
          accessibilityLabel="Abrir perfil"
          onPress={() => router.push('/(app)/account')}
        >
          {profilePhotoUri ? (
            <Image source={{ uri: profilePhotoUri }} style={styles.profileImage} resizeMode="cover" />
          ) : (
            <UserCircleIcon color={colors.brand} size={26} strokeWidth={1.8} />
          )}
        </Pressable>
        <View style={styles.topBarSpacer} />
        <View style={styles.topActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ler QR code"
            hitSlop={8}
            onPress={() => router.push('/(app)/universal-qr-scanner')}
          >
            <QrCodeIcon color={colors.ink} size={25} strokeWidth={1.8} />
          </Pressable>
          <View style={styles.notificationAction}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={unreadCount > 0 ? `Notificações, ${unreadCount} não lidas` : 'Notificações'}
              hitSlop={8}
              onPress={() => setNotificationsOpen(true)}
              style={({ pressed }) => [styles.topAction, pressed ? styles.pressed : null]}
            >
              <BellIcon color={colors.ink} size={25} strokeWidth={1.8} />
            </Pressable>
            {unreadCount > 0 ? (
              <View pointerEvents="none" accessible accessibilityLabel="Há notificações não lidas" style={styles.notificationBadge} />
            ) : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Ajuda" hitSlop={8} style={styles.topAction}>
            <QuestionMarkCircleIcon color={colors.ink} size={25} strokeWidth={1.8} />
          </Pressable>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abrir busca"
        onPress={() => router.push('/(app)/search')}
        style={styles.searchField}
      >
        <MagnifyingGlassIcon color={colors.inkMuted} size={23} strokeWidth={1.8} />
        <AppText tone="muted" style={styles.searchPlaceholder}>Pesquisar</AppText>
      </Pressable>

      <View style={styles.accountSummary}>
        <View style={styles.summaryCopy}>
          <AppText variant="small" tone="muted" weight="medium">Seja bem-vindo(a)</AppText>
          <AppText variant="heading" weight="medium" numberOfLines={1}>{userName}</AppText>
        </View>
      </View>

      <View style={styles.quickActionsRow}>
        {quickActions.map(({ label, icon: Icon }) => (
          <Pressable
            key={label}
            style={styles.quickAction}
            accessibilityRole="button"
            onPress={label === 'Alunos'
              ? () => router.push('/(app)/students')
              : label === 'Agenda'
                ? () => router.push('/(app)/agenda')
                : undefined}
          >
            <Icon color={colors.brand} size={19} strokeWidth={1.8} />
            <AppText variant="small" weight="medium">{label}</AppText>
          </Pressable>
        ))}
      </View>

      <View style={styles.actionSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.actionRail}
        >
          {quickActionCards.map(({ label, icon: Icon }) => {
            const content = (
              <>
                <Icon color={colors.inkMuted} size={22} strokeWidth={1.8} />
                <AppText variant="small" weight="medium" numberOfLines={2}>{label}</AppText>
              </>
            );

            if (label === 'Criar cobrança' || label === 'Extrato financeiro' || label === 'Simular venda') {
              return (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  onPress={() => router.push(
                    label === 'Criar cobrança'
                      ? '/(app)/billing/create'
                      : label === 'Extrato financeiro'
                        ? '/(app)/statement'
                        : '/(app)/simulator',
                  )}
                  style={({ pressed }) => [styles.actionCard, pressed ? styles.pressed : null]}
                >
                  {content}
                </Pressable>
              );
            }

            return <View key={label} accessible accessibilityLabel={`${label}, disponível em breve`} style={styles.actionCard}>{content}</View>;
          })}
        </ScrollView>
      </View>

      <View style={styles.sectionHeader}>
        <AppText variant="subheading" weight="medium">Acesso rápido</AppText>
      </View>

      <ScrollView
        ref={moduleRail}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={moduleWidth + spacing.md}
        onMomentumScrollEnd={handleModuleScroll}
        contentContainerStyle={styles.moduleRail}
      >
        {moduleCards.map(({ title, description }) => (
          <Pressable
            key={title}
            style={[styles.moduleCard, { width: moduleWidth }]}
            accessibilityRole="button"
            accessibilityLabel={title}
            onPress={title === 'Matrículas'
              ? () => router.push('/(app)/enrollments')
              : title === 'Cobranças'
                ? () => router.push('/(app)/billing')
                : undefined}
          >
            <View style={styles.moduleCardTop}>
              <View style={styles.moduleCardArrow}>
                <ArrowRightIcon color={colors.brand} size={20} strokeWidth={1.8} />
              </View>
            </View>
            <View style={styles.moduleCopy}>
              <AppText variant="heading" weight="medium">{title}</AppText>
              <AppText tone="muted" style={styles.moduleDescription}>{description}</AppText>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.pagination} accessibilityLabel={`Módulo ${moduleIndex + 1} de ${moduleCards.length}`}>
        {moduleCards.map((card, index) => (
          <View key={card.title} style={[styles.paginationDot, index === moduleIndex && styles.paginationDotActive]} />
        ))}
      </View>
      </Screen>
      <NotificationsSheet visible={notificationsOpen} onClose={() => setNotificationsOpen(false)} notifications={notifications} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: 116 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  topBarSpacer: { flex: 1 },
  profileButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surfaceNeutral },
  profileImage: { width: '100%', height: '100%', borderRadius: radius.pill },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  topAction: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  notificationAction: { position: 'relative' },
  notificationBadge: { position: 'absolute', top: 1, right: 1, width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.danger },
  searchField: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface },
  searchPlaceholder: { flex: 1 },
  accountSummary: { paddingVertical: spacing.sm },
  summaryCopy: { flex: 1, gap: spacing.xs },
  quickActionsRow: { width: '100%', flexDirection: 'row', gap: spacing.sm },
  quickAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brandSoft },
  actionSection: { gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md },
  actionRail: { gap: spacing.md },
  actionCard: { width: 138, minHeight: 124, justifyContent: 'space-between', alignItems: 'flex-start', padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  pressed: { opacity: 0.76 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  moduleRail: { gap: spacing.md },
  moduleCard: { minHeight: 174, justifyContent: 'flex-end', padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  moduleCardTop: { position: 'absolute', top: spacing.lg, right: spacing.lg },
  moduleCardArrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandSoft },
  moduleCopy: { gap: spacing.xs },
  moduleDescription: { maxWidth: 245 },
  pagination: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs },
  paginationDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.border },
  paginationDotActive: { width: 18, backgroundColor: colors.brand },
});
