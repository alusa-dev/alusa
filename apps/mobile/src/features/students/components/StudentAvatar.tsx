import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/primitives/AppText';
import { mobileEnv } from '@/config/env';
import { resolveProfilePhotoUri } from '@/features/session/utils/profile-photo';
import { colors } from '@/theme/tokens';

type StudentAvatarProps = {
  name: string;
  photo: string | null;
  size?: number;
};

export function StudentAvatar({ name, photo, size = 44 }: StudentAvatarProps) {
  const [photoAvailable, setPhotoAvailable] = useState(Boolean(photo));
  const photoUri = resolveProfilePhotoUri(photo, mobileEnv.apiUrl);

  if (photoAvailable && photoUri) {
    return (
      <Image
        accessibilityLabel={`Foto de ${name}`}
        source={{ uri: photoUri }}
        style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
        resizeMode="cover"
        onError={() => setPhotoAvailable(false)}
      />
    );
  }

  return (
    <View
      accessibilityLabel={`Iniciais de ${name}`}
      style={[styles.avatar, styles.initialsAvatar, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <AppText variant="small" weight="medium" style={styles.initials}>{getInitials(name)}</AppText>
    </View>
  );
}

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  initialsAvatar: { backgroundColor: colors.brandSoft },
  initials: { color: colors.brand },
});
