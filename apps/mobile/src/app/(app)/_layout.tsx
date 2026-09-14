import { Stack, router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { DocumentChartBarIcon, HomeIcon, ListBulletIcon, UserCircleIcon } from 'react-native-heroicons/outline';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, shadows } from '@/theme/tokens';

const dockItems = [
  { key: 'home', label: 'Ir para início', Icon: HomeIcon, href: '/(app)' as const },
  { key: 'report', label: 'Ir para relatório', Icon: DocumentChartBarIcon, href: '/(app)/report' as const },
  { key: 'account', label: 'Conta', Icon: UserCircleIcon, href: null },
  { key: 'todos', label: 'Ir para todos', Icon: ListBulletIcon, href: '/(app)/todos' as const },
] as const;

export default function AuthenticatedLayout() {
  return (
    <View style={styles.container}>
      <Stack key="alusa-app-stack-v2" screenOptions={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: true, gestureDirection: 'horizontal' }}>
        <Stack.Screen name="index" options={{ animation: 'none', gestureEnabled: false }} />
        <Stack.Screen name="todos" options={{ animation: 'none', gestureEnabled: false }} />
      </Stack>
      <FloatingDock />
    </View>
  );
}

function FloatingDock() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const bottom = Math.max(Platform.OS === 'ios' ? 14 : 10, insets.bottom + 8);
  const isReport = pathname === '/report' || pathname === '/(app)/report';
  const isTodos = pathname === '/todos' || pathname === '/(app)/todos';
  const currentKey = isReport ? 'report' : isTodos ? 'todos' : 'home';
  const activeIndex = dockItems.findIndex((item) => item.key === currentKey);
  const activeIndicatorX = useRef(new Animated.Value(activeIndex * 61)).current;
  const visible = pathname === '/' || pathname === '/index' || pathname === '/(app)' || isReport || isTodos;

  useEffect(() => {
    Animated.timing(activeIndicatorX, {
      toValue: activeIndex * 61,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, activeIndicatorX]);

  if (!visible) return null;

  return (
    <View style={[styles.dock, { bottom }]}>
      <Animated.View style={[styles.activeIndicator, { transform: [{ translateX: activeIndicatorX }] }]} />
      {dockItems.map(({ key, label, Icon, href }) => {
        const focused = key === currentKey;
        const disabled = href === null;
        return (
          <Pressable
            key={key}
            style={styles.dockItem}
            onPress={() => href && !focused ? router.navigate(href) : undefined}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={focused ? { selected: true } : {}}
            hitSlop={4}
          >
            <View style={styles.iconSlot}>
              <Icon color={focused ? colors.brand : colors.inkSubtle} size={24} strokeWidth={1.8} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  dock: {
    position: 'absolute',
    alignSelf: 'center',
    width: 245,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 5,
    paddingTop: 3,
    paddingRight: 3,
    paddingBottom: 4,
    paddingLeft: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
  dockItem: {
    width: 56,
    height: 57,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  activeIndicator: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: 56,
    height: 57,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  iconSlot: {
    width: 56,
    height: 57,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
});
