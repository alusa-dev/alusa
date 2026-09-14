import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeftIcon, EllipsisVerticalIcon, StarIcon, TrashIcon } from 'react-native-heroicons/outline';

import { AppText } from '@/components/primitives/AppText';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Screen } from '@/components/layout/Screen';
import { useSession } from '@/features/session/hooks/use-session';
import { removeSavedAccessProfile, updateSavedAccessProfile } from '@/features/session/services/session-service';
import { readSavedAccessProfiles } from '@/features/session/services/session-storage';
import { useSessionStore } from '@/features/session/stores/session-store';
import type { SavedAccessProfile } from '@/features/session/types/session';
import { colors, radius, spacing } from '@/theme/tokens';

const ACTION_WIDTH = 136;

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!name || !domain) return email;
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(3, Math.min(name.length, 5)))}@${domain}`;
}

function initials(name?: string | null, email?: string) {
  const source = name?.trim() || email?.trim() || 'A';
  return source.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

function profileKey(profile: SavedAccessProfile) {
  return `${profile.user.id}:${profile.activeContaId ?? profile.user.contaId ?? 'default'}`;
}

function sortProfiles(profiles: SavedAccessProfile[]) {
  return [...profiles].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
}

function goBackOrStart() {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/login');
}

export default function SelectAccountScreen() {
  const { lockedProfile, savedProfile } = useSession();
  const [profiles, setProfiles] = useState<SavedAccessProfile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readSavedAccessProfiles().then((storedProfiles) => {
      if (active) {
        setProfiles(sortProfiles(storedProfiles));
        setProfilesLoaded(true);
      }
    });
    return () => { active = false; };
  }, [lockedProfile, savedProfile]);

  const visibleProfiles = useMemo(() => {
    if (profiles.length > 0) return profiles;
    return !profilesLoaded && (savedProfile || lockedProfile) ? [lockedProfile ?? savedProfile!] : [];
  }, [lockedProfile, profiles, profilesLoaded, savedProfile]);

  useEffect(() => {
    if (profilesLoaded && profiles.length === 0) router.replace('/login');
  }, [profiles.length, profilesLoaded]);

  const selectProfile = useCallback((profile: SavedAccessProfile) => {
    useSessionStore.getState().setSavedProfile(profile);
    router.replace('/unlock');
  }, []);

  const toggleFavorite = useCallback(async (profile: SavedAccessProfile) => {
    const nextFavorite = !profile.favorite;
    await updateSavedAccessProfile(profile, { favorite: nextFavorite });
    setProfiles((current) => sortProfiles(current.map((item) =>
      profileKey(item) === profileKey(profile) ? { ...item, favorite: nextFavorite } : item,
    )));
    setRevealedKey(null);
  }, []);

  const deleteProfile = useCallback((profile: SavedAccessProfile) => {
    Alert.alert('Excluir acesso salvo?', 'Você poderá adicionar esta conta novamente quando quiser.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const remaining = sortProfiles(await removeSavedAccessProfile(profile));
            const selectedProfile = useSessionStore.getState().savedProfile;
            if (selectedProfile && profileKey(selectedProfile) === profileKey(profile)) {
              useSessionStore.getState().setSavedProfile(remaining[0] ?? null);
            }
            setProfiles(remaining);
            if (remaining.length === 0) {
              useSessionStore.getState().setAnonymous();
              router.replace('/login');
            }
          })();
        },
      },
    ]);
  }, []);

  if (!profilesLoaded) {
    return (
      <Screen backgroundColor={colors.white} style={styles.screen}>
        <View style={styles.header}><View style={styles.backButton} /></View>
        <View style={styles.content} accessibilityLabel="Carregando acessos salvos">
          <Skeleton width="70%" height={30} />
          <View style={styles.list}>
            {[0, 1].map((item) => (
              <View key={item} style={styles.skeletonCard}>
                <Skeleton width={52} height={52} radius={radius.pill} />
                <View style={styles.skeletonCopy}><Skeleton width="72%" height={18} /><Skeleton width="88%" height={15} /><Skeleton width="42%" height={20} radius={radius.sm} /></View>
              </View>
            ))}
          </View>
        </View>
      </Screen>
    );
  }

  if (visibleProfiles.length === 0) return null;

  return (
    <Screen backgroundColor={colors.white} style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={12} onPress={goBackOrStart} style={styles.backButton}>
          <ChevronLeftIcon size={32} color={colors.ink} strokeWidth={1.5} />
        </Pressable>
      </View>
      <View style={styles.content}>
        <AppText variant="heading" weight="medium" style={styles.title}>Escolha um acesso</AppText>
        <View style={styles.list}>
          {visibleProfiles.map((profile) => (
            <SavedProfileCard
              key={profileKey(profile)}
              profile={profile}
              revealed={revealedKey === profileKey(profile)}
              onReveal={() => setRevealedKey(profileKey(profile))}
              onClose={() => setRevealedKey(null)}
              onSelect={() => selectProfile(profile)}
              onFavorite={() => void toggleFavorite(profile)}
              onDelete={() => deleteProfile(profile)}
            />
          ))}
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Adicionar ou abrir conta" onPress={() => router.replace('/login')} style={({ pressed }) => [styles.addAccount, pressed ? styles.pressed : null]}>
        <AppText variant="subheading" weight="medium" tone="primary">Adicionar ou abrir conta</AppText>
      </Pressable>
    </Screen>
  );
}

function SavedProfileCard({ profile, revealed, onReveal, onClose, onSelect, onFavorite, onDelete }: {
  profile: SavedAccessProfile;
  revealed: boolean;
  onReveal: () => void;
  onClose: () => void;
  onSelect: () => void;
  onFavorite: () => void;
  onDelete: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8,
    onPanResponderMove: (_, gesture) => translateX.setValue(Math.min(0, Math.max(-ACTION_WIDTH, gesture.dx))),
    onPanResponderRelease: (_, gesture) => {
      const shouldReveal = gesture.dx < -48;
      Animated.spring(translateX, { toValue: shouldReveal ? -ACTION_WIDTH : 0, useNativeDriver: true, bounciness: 5 }).start();
      if (shouldReveal) onReveal(); else onClose();
    },
  }), [onClose, onReveal, translateX]);

  useEffect(() => {
    Animated.spring(translateX, { toValue: revealed ? -ACTION_WIDTH : 0, useNativeDriver: true, bounciness: 5 }).start();
  }, [revealed, translateX]);

  return (
    <View style={styles.swipeRow}>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel={profile.favorite ? 'Desfavoritar acesso' : 'Favoritar acesso'} onPress={onFavorite} style={({ pressed }) => [styles.actionButton, pressed ? styles.pressed : null]}>
          <StarIcon size={27} color={colors.brand} strokeWidth={1.7} fill={profile.favorite ? colors.brand : 'transparent'} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Excluir acesso" onPress={onDelete} style={({ pressed }) => [styles.actionButton, pressed ? styles.pressed : null]}>
          <TrashIcon size={27} color={colors.danger} strokeWidth={1.7} />
        </Pressable>
      </View>
      <Animated.View style={[styles.card, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Selecionar ${profile.user.name ?? profile.user.email}`} onPress={onSelect} style={({ pressed }) => [styles.cardPressable, pressed ? styles.pressed : null]}>
          <View style={styles.avatar}><AppText variant="subheading" weight="medium" tone="inverse">{initials(profile.user.name, profile.user.email)}</AppText></View>
          <View style={styles.profileCopy}>
            <AppText variant="subheading" weight="medium" numberOfLines={1}>{profile.user.name || 'Usuário Alusa'}</AppText>
            <AppText variant="body" tone="muted" numberOfLines={1}>{maskEmail(profile.user.email)}</AppText>
            <View style={styles.tag}><AppText variant="small" weight="medium" tone="primary">{profile.biometricEnabled ? 'Face ID ativado' : 'Acesso salvo'}</AppText></View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Mais opções do acesso" hitSlop={8} onPress={onReveal} style={styles.moreButton}>
            <EllipsisVerticalIcon size={24} color={colors.inkMuted} />
          </Pressable>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing['2xl'] },
  header: { height: 48 },
  backButton: { width: 42, height: 42, justifyContent: 'center' },
  content: { flex: 1, paddingTop: spacing['3xl'], gap: spacing.xl },
  title: { fontSize: 30, lineHeight: 36 },
  list: { gap: spacing.md },
  swipeRow: { minHeight: 112, borderRadius: radius.lg, overflow: 'hidden' },
  actions: { ...StyleSheet.absoluteFill, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surface },
  actionButton: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  card: { minHeight: 112, borderRadius: radius.lg, backgroundColor: colors.surfaceRaised },
  cardPressable: { minHeight: 112, flexDirection: 'row', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  avatar: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  profileCopy: { flex: 1, gap: spacing.xs },
  tag: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.brandSoft },
  moreButton: { padding: spacing.xs },
  addAccount: { alignItems: 'center', paddingVertical: spacing.lg },
  pressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
  skeletonCard: { minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceNeutral },
  skeletonCopy: { flex: 1, gap: spacing.xs },
});
