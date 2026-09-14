import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ArrowLeftIcon, FunnelIcon, MagnifyingGlassIcon, XMarkIcon } from 'react-native-heroicons/outline';

import { AppText } from '@/components/primitives/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

type InlineSearchHeaderProps = {
  title: string;
  search: string;
  onSearchChange: (value: string) => void;
  placeholder: string;
  onBack?: () => void;
  showBack?: boolean;
  onFilterPress?: () => void;
  filterActive?: boolean;
  accessibilityLabel?: string;
};

/** Cabeçalho de lista com busca inline e filtro no mesmo padrão visual da Alusa. */
export function InlineSearchHeader({
  title,
  search,
  onSearchChange,
  placeholder,
  onBack,
  showBack = true,
  onFilterPress,
  filterActive = false,
  accessibilityLabel = 'Pesquisar',
}: InlineSearchHeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchWidth, setSearchWidth] = useState(0);
  const searchInputRef = useRef<TextInput>(null);
  const searchProgress = useRef(new Animated.Value(0)).current;
  const closeAnimationId = useRef(0);

  useEffect(() => {
    if (!searchOpen) return undefined;
    closeAnimationId.current += 1;
    const animation = Animated.timing(searchProgress, { toValue: 1, duration: 220, useNativeDriver: false });
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    animation.start();
    return () => {
      cancelAnimationFrame(frame);
      animation.stop();
    };
  }, [searchOpen, searchProgress]);

  const closeSearch = useCallback(() => {
    if (!searchOpen) return;
    Keyboard.dismiss();
    onSearchChange('');
    const animationId = ++closeAnimationId.current;
    Animated.timing(searchProgress, { toValue: 0, duration: 180, useNativeDriver: false }).start(({ finished }) => {
      if (finished && animationId === closeAnimationId.current) setSearchOpen(false);
    });
  }, [onSearchChange, searchOpen, searchProgress]);

  return (
    <View style={styles.header}>
      {showBack && onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={10} onPress={onBack} style={styles.iconButton}>
          <ArrowLeftIcon color={colors.ink} size={25} strokeWidth={1.8} />
        </Pressable>
      ) : null}
      <View style={styles.headerMiddle} onLayout={(event) => setSearchWidth(event.nativeEvent.layout.width)}>
        {searchOpen ? (
          <Animated.View style={[styles.searchContainer, { width: searchProgress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(searchWidth, 1)] }) }]}>
            <TextInput
              ref={searchInputRef}
              value={search}
              onChangeText={onSearchChange}
              placeholder={placeholder}
              placeholderTextColor={colors.inkSubtle}
              accessibilityLabel={accessibilityLabel}
              returnKeyType="search"
              autoCapitalize="words"
              style={styles.searchInput}
            />
          </Animated.View>
        ) : (
          <AppText variant="heading" weight="medium" numberOfLines={1}>{title}</AppText>
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={searchOpen ? 'Fechar pesquisa' : accessibilityLabel}
        accessibilityState={{ expanded: searchOpen }}
        hitSlop={10}
        onPress={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
        style={styles.iconButton}
      >
        {searchOpen ? <XMarkIcon color={colors.brand} size={23} strokeWidth={1.8} /> : <MagnifyingGlassIcon color={colors.brand} size={23} strokeWidth={1.8} />}
      </Pressable>
      {onFilterPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Filtrar" accessibilityState={{ selected: filterActive }} hitSlop={10} onPress={onFilterPress} style={styles.iconButton}>
          <FunnelIcon color={colors.brand} size={23} strokeWidth={1.8} />
          {filterActive ? <View style={styles.filterIndicator} /> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  iconButton: { position: 'relative', width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  headerMiddle: { flex: 1, minWidth: 0, justifyContent: 'center' },
  searchContainer: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', overflow: 'hidden' },
  searchInput: { width: '100%', minHeight: 44, paddingHorizontal: spacing.lg, paddingVertical: 0, borderRadius: radius.pill, backgroundColor: colors.surfaceNeutral, color: colors.ink, fontSize: 16 },
  filterIndicator: { position: 'absolute', top: 8, right: 7, width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.accent },
});
