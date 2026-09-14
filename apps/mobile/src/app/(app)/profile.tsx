import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ArrowLeftIcon, ChevronRightIcon, PencilSquareIcon, UserCircleIcon } from 'react-native-heroicons/outline';

import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { Button } from '@/components/primitives/Button';
import { TextField } from '@/components/primitives/TextField';
import { mobileEnv } from '@/config/env';
import { authService } from '@/features/auth/services/auth-service';
import { useSession } from '@/features/session/hooks/use-session';
import { updateCurrentUser } from '@/features/session/services/session-service';
import { resolveProfilePhotoUri } from '@/features/session/utils/profile-photo';
import { colors, radius, spacing } from '@/theme/tokens';

type ImageSource = 'camera' | 'library';

export default function ProfileScreen() {
  const { session } = useSession();
  const [displayName, setDisplayName] = useState(session?.user.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();
  const [photoError, setPhotoError] = useState<string | null>(null);

  const user = session?.user;
  const name = displayName.trim() || 'Usuário Alusa';
  const photoUri = resolveProfilePhotoUri(user?.foto, mobileEnv.apiUrl);
  const nameChanged = displayName.trim() !== (user?.name?.trim() ?? '');

  async function saveName() {
    const normalizedName = displayName.trim();
    if (normalizedName.length < 2) {
      setNameError('Informe seu nome.');
      return;
    }
    if (!nameChanged || savingName) return;

    setNameError(undefined);
    setSavingName(true);
    try {
      const response = await authService.updateProfile({ name: normalizedName });
      await updateCurrentUser({ name: response.user.name ?? normalizedName });
    } catch (error) {
      setNameError(error instanceof Error ? error.message : 'Não foi possível salvar seu nome.');
    } finally {
      setSavingName(false);
    }
  }

  function choosePhotoSource() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Tirar foto', 'Escolher Foto', 'Cancelar'],
          cancelButtonIndex: 2,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) void selectPhoto('camera');
          if (buttonIndex === 1) void selectPhoto('library');
        },
      );
      return;
    }

    Alert.alert('Alterar foto', undefined, [
      { text: 'Tirar foto', onPress: () => void selectPhoto('camera') },
      { text: 'Escolher foto', onPress: () => void selectPhoto('library') },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }

  async function selectPhoto(source: ImageSource) {
    if (uploadingPhoto) return;
    setPhotoError(null);

    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPhotoError('Permita o acesso para escolher uma foto.');
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;

    setUploadingPhoto(true);
    try {
      const processed = await manipulateAsync(
        asset.uri,
        [{ resize: { width: 512, height: 512 } }],
        { compress: 0.85, format: SaveFormat.JPEG },
      );
      const formData = new FormData();
      formData.append('file', {
        uri: processed.uri,
        name: 'profile.jpg',
        type: 'image/jpeg',
      } as unknown as Blob);
      const response = await authService.uploadProfilePhoto(formData);
      await updateCurrentUser({ foto: response.url });
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Não foi possível atualizar sua foto.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  return (
    <Screen scroll backgroundColor={colors.surface} style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
        </Pressable>
        <AppText variant="heading" weight="medium">Perfil</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.profileHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Alterar foto de perfil"
          disabled={uploadingPhoto}
          onPress={choosePhotoSource}
          style={({ pressed }) => [styles.avatarPressable, pressed ? styles.pressed : null, uploadingPhoto ? styles.disabled : null]}
        >
          <View style={styles.avatar}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarImage} resizeMode="cover" />
            ) : (
              <UserCircleIcon color={colors.brand} size={54} strokeWidth={1.7} />
            )}
          </View>
          <View style={styles.editBadge}>
            <PencilSquareIcon color={colors.brand} size={21} strokeWidth={1.8} />
          </View>
        </Pressable>
        <View style={styles.profileCopy}>
          <AppText variant="subheading" weight="medium" numberOfLines={1}>{name}</AppText>
          <AppText tone="muted">Exibida apenas para você</AppText>
        </View>
      </View>

      {photoError ? <AppText variant="small" tone="danger">{photoError}</AppText> : null}

      <TextField
        label="Nome de exibição"
        value={displayName}
        onChangeText={(value) => {
          setDisplayName(value);
          if (nameError) setNameError(undefined);
        }}
        error={nameError}
        editable={!savingName}
        size="large"
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={() => void saveName()}
      />

      <View style={styles.options}>
        <ProfileOption label="Dados pessoais" onPress={() => router.push('/(app)/personal-data')} />
        <ProfileOption label="Segurança e acesso" onPress={() => router.push('/(app)/account')} />
      </View>

      <Button
        title="Salvar alterações"
        variant="primary"
        loading={savingName}
        disabled={!nameChanged}
        onPress={() => void saveName()}
        style={styles.saveButton}
      />
    </Screen>
  );
}

function ProfileOption({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed ? styles.pressed : null]}
    >
      <AppText variant="subheading" weight="medium">{label}</AppText>
      <ChevronRightIcon color={colors.inkMuted} size={22} strokeWidth={1.8} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.xl,
    paddingBottom: 128,
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    flex: 1,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
  },
  avatarPressable: {
    position: 'relative',
  },
  avatar: {
    width: 104,
    height: 104,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceNeutral,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  editBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  profileCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  options: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  option: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  saveButton: {
    marginTop: spacing.md,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
});
