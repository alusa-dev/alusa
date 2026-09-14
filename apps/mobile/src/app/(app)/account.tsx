import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ArrowLeftIcon, ArrowRightOnRectangleIcon, BellIcon, BuildingOfficeIcon, ChevronRightIcon, DevicePhoneMobileIcon, KeyIcon, PencilSquareIcon, QuestionMarkCircleIcon, ShieldCheckIcon, UserCircleIcon } from 'react-native-heroicons/outline';

import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { mobileEnv } from '@/config/env';
import { authService } from '@/features/auth/services/auth-service';
import { useSession } from '@/features/session/hooks/use-session';
import { resolveProfilePhotoUri } from '@/features/session/utils/profile-photo';
import { useSessionStore } from '@/features/session/stores/session-store';
import { colors, radius, spacing } from '@/theme/tokens';

export default function AccountScreen() {
  const queryClient = useQueryClient();
  const { session, savedProfile } = useSession();
  const user = session?.user;
  const userName = user?.name?.trim() || 'Usuário Alusa';
  const userEmail = user?.email ?? 'E-mail não informado';
  const role = formatRole(user?.role);
  const photoUri = resolveProfilePhotoUri(user?.foto, mobileEnv.apiUrl);
  const biometricEnabled = Boolean(savedProfile?.biometricEnabled);

  async function handleLogout() {
    Alert.alert('Sair do app?', 'Você poderá entrar novamente quando precisar.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: async () => { await authService.logout(queryClient, { preserveSavedAccess: true }); router.replace(useSessionStore.getState().savedProfile ? '/(public)/select-account' : '/(public)/login'); } },
    ]);
  }

  return <Screen scroll backgroundColor={colors.surface} style={styles.screen}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={10} onPress={() => router.back()} style={styles.headerButton}><ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} /></Pressable><View style={styles.headerSpacer} /><Pressable accessibilityRole="button" accessibilityLabel="Notificações" hitSlop={10} style={styles.headerButton}><BellIcon color={colors.ink} size={24} strokeWidth={1.8} /></Pressable></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Editar perfil" onPress={() => router.push('/(app)/profile')} style={({ pressed }) => [styles.identity, pressed ? styles.pressed : null]}>
      <View style={styles.avatar}>{photoUri ? <Image source={{ uri: photoUri }} style={styles.avatarImage} resizeMode="cover" /> : <UserCircleIcon color={colors.brand} size={54} strokeWidth={1.7} />}</View>
      <View style={styles.identityCopy}><AppText variant="subheading" weight="medium" numberOfLines={1}>{userName}</AppText><AppText tone="muted" numberOfLines={1} ellipsizeMode="middle">{userEmail}</AppText><View style={styles.roleBadge}><AppText variant="small" weight="medium">{role}</AppText></View></View>
      <ChevronRightIcon color={colors.inkMuted} size={22} strokeWidth={1.8} />
    </Pressable>
    <View style={styles.profileCards}><ProfileCard icon={PencilSquareIcon} title={'Dados\npessoais'} accessibilityLabel="Dados pessoais" onPress={() => router.push('/(app)/personal-data')} /><ProfileCard icon={BuildingOfficeIcon} title="Dados escolares" onPress={() => router.push('/(app)/school-data')} /></View>
    <View style={styles.securitySection}>
      <View style={styles.sectionHeader}><AppText variant="subheading" weight="medium">Central de segurança</AppText><ChevronRightIcon color={colors.inkMuted} size={22} strokeWidth={1.8} /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.securityCards}>
        <SecurityCard icon={KeyIcon} title="Alterar senha" description="Atualize sua senha de acesso" onPress={() => router.push('/(app)/change-password')} />
        <SecurityCard icon={DevicePhoneMobileIcon} title="Biometria" description={biometricEnabled ? 'Ativada neste aparelho' : 'Ative para entrar mais rápido'} onPress={() => router.push('/(app)/biometrics')} />
        <SecurityCard icon={ShieldCheckIcon} title="Token e autorizações" description="Gerencie acessos autorizados" onPress={() => Alert.alert('Token e autorizações', 'A gestão de autorizações estará disponível em breve.')} />
      </ScrollView>
    </View>
    <View style={styles.utilityList}>
      <UtilityRow icon={QuestionMarkCircleIcon} title="Central de ajuda" onPress={() => Alert.alert('Central de ajuda', 'A central de ajuda estará disponível em breve.')} />
      <UtilityRow icon={ArrowRightOnRectangleIcon} title="Sair do app" description="Versão 0.1.0" destructive onPress={() => void handleLogout()} />
    </View>
  </Screen>;
}

function ProfileCard({ icon: Icon, title, description, accessibilityLabel, onPress }: { icon: typeof PencilSquareIcon; title: string; description?: string; accessibilityLabel?: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} onPress={onPress} style={({ pressed }) => [styles.profileCard, pressed ? styles.pressed : null]}><Icon color={colors.inkMuted} size={22} strokeWidth={1.8} /><View style={styles.cardCopy}><AppText variant="body" weight="medium" numberOfLines={2}>{title}</AppText>{description ? <AppText variant="small" tone="muted" numberOfLines={1}>{description}</AppText> : null}</View></Pressable>; }
function SecurityCard({ icon: Icon, title, description, onPress }: { icon: typeof KeyIcon; title: string; description: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.securityCard, pressed ? styles.pressed : null]}><AppText weight="medium" numberOfLines={2}>{title}</AppText><View style={styles.securityCardFooter}><AppText variant="small" tone="muted" numberOfLines={2} style={styles.securityCardDescription}>{description}</AppText><Icon color={colors.inkMuted} size={24} strokeWidth={1.8} /></View></Pressable>; }
function UtilityRow({ icon: Icon, title, description, onPress, destructive = false }: { icon: typeof QuestionMarkCircleIcon; title: string; description?: string; onPress: () => void; destructive?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.utilityRow, pressed ? styles.pressed : null]}><Icon color={destructive ? colors.danger : colors.ink} size={28} strokeWidth={1.8} /><View style={styles.rowCopy}><AppText weight="medium" style={destructive ? styles.destructive : undefined}>{title}</AppText>{description ? <AppText variant="body" tone="muted">{description}</AppText> : null}</View></Pressable>; }
function formatRole(role?: string | null) { switch (role?.toUpperCase()) { case 'ADMIN': return 'Administrador'; case 'PROFESSOR': return 'Professor'; case 'RESPONSAVEL': return 'Responsável'; case 'ALUNO': return 'Aluno'; default: return role || 'Usuário'; } }

const styles = StyleSheet.create({ screen: { gap: spacing.xl, paddingBottom: 128 }, header: { flexDirection: 'row', alignItems: 'center', minHeight: 44 }, headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, headerSpacer: { flex: 1 }, identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }, avatar: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: radius.pill, backgroundColor: colors.surfaceNeutral }, avatarImage: { width: '100%', height: '100%' }, identityCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, roleBadge: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.brandSoft }, profileCards: { flexDirection: 'row', gap: spacing.md }, profileCard: { flex: 1, aspectRatio: 1, maxWidth: 148, justifyContent: 'space-between', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral }, cardCopy: { gap: spacing.xs }, securitySection: { gap: spacing.md }, sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, securityCards: { gap: spacing.md, paddingRight: spacing.xl }, securityCard: { width: 220, height: 136, justifyContent: 'space-between', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral }, securityCardFooter: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }, securityCardDescription: { flex: 1 }, utilityList: { gap: spacing.sm }, utilityRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.md }, rowCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, destructive: { color: colors.danger }, pressed: { opacity: 0.78 } });
