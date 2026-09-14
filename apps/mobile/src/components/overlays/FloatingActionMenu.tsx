import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import type { ComponentType } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EllipsisVerticalIcon, XMarkIcon } from 'react-native-heroicons/outline';

import { AppText } from '@/components/primitives/AppText';
import { colors, radius, shadows, spacing } from '@/theme/tokens';

const MODAL_HANDOFF_DELAY_MS = 50;

export type FloatingAction = {
  key: string;
  label: string;
  Icon: ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  onPress: () => void;
  destructive?: boolean;
};

export function FloatingActionMenu({ actions, accessibilityLabel = 'opções de ações' }: { actions: FloatingAction[]; accessibilityLabel?: string }) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const progress = useRef(actions.map(() => new Animated.Value(0))).current;
  const backdropProgress = useRef(new Animated.Value(0)).current;
  const pendingActionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!mounted) return;
    const backdropAnimation = Animated.timing(backdropProgress, {
      toValue: open ? 1 : 0,
      duration: 220,
      easing: open ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    backdropAnimation.start();
    const sequence = open ? [...progress].reverse() : progress;
    const animation = Animated.stagger(90, sequence.map((value) => Animated.timing(value, {
      toValue: open ? 1 : 0,
      duration: 190,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    })));
    animation.start(({ finished }) => {
      if (!finished || open) return;

      setMounted(false);
      const pendingAction = pendingActionRef.current;
      pendingActionRef.current = null;

      // The action can open another native modal (for example, a BottomSheet).
      // Wait for this Modal to unmount before presenting the next one. Presenting
      // two native modals during the same transition is ignored on iOS and can
      // make the action look like it did nothing.
      if (pendingAction) setTimeout(pendingAction, MODAL_HANDOFF_DELAY_MS);
    });
    return () => { animation.stop(); backdropAnimation.stop(); };
  }, [backdropProgress, mounted, open, progress]);

  const show = () => { setMounted(true); setOpen(true); };
  const hide = () => setOpen(false);
  const handleActionPress = (action: FloatingAction) => {
    if (pendingActionRef.current) return;
    pendingActionRef.current = action.onPress;
    hide();
  };
  const bottom = Math.max(insets.bottom + spacing.lg, spacing['2xl']);

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={open ? `Fechar ${accessibilityLabel}` : `Abrir ${accessibilityLabel}`} onPress={open ? hide : show} style={[styles.fab, { bottom }]}>
        {open ? <XMarkIcon color={colors.white} size={28} strokeWidth={1.9} /> : <EllipsisVerticalIcon color={colors.white} size={29} strokeWidth={1.9} />}
      </Pressable>
      <Modal visible={mounted} transparent animationType="none" onRequestClose={hide}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityLabel={`Fechar ${accessibilityLabel}`} onPress={hide} style={styles.backdropPressable}>
            <Animated.View pointerEvents="none" style={[styles.backdrop, { opacity: backdropProgress }]} />
          </Pressable>
          <View pointerEvents="box-none" style={[styles.actions, { bottom: bottom + 76 }]}>
            {actions.map((action, index) => {
              const Icon = action.Icon;
              const value = progress[index] ?? new Animated.Value(0);
              return (
                <Animated.View key={action.key} style={{ opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [18 + index * 5, 0] }) }] }}>
                  <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={() => handleActionPress(action)} style={({ pressed }) => [styles.actionRow, pressed ? styles.pressed : null]}>
                    <View style={styles.actionLabel}><AppText weight="medium" style={action.destructive ? styles.destructiveText : undefined}>{action.label}</AppText></View>
                    <View style={styles.actionIcon}><Icon color={action.destructive ? colors.danger : colors.brand} size={24} strokeWidth={1.8} /></View>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Fechar ${accessibilityLabel}`} onPress={hide} style={[styles.fab, { bottom }]}><XMarkIcon color={colors.white} size={28} strokeWidth={1.9} /></Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: spacing.xl, width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.brand, ...shadows.card, zIndex: 20 },
  modalRoot: { flex: 1 },
  backdropPressable: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.58)' },
  actions: { position: 'absolute', right: spacing.xl, alignItems: 'flex-end', gap: spacing.md },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actionLabel: { minHeight: 54, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surface, ...shadows.soft },
  actionIcon: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.surface, ...shadows.soft },
  destructiveText: { color: colors.danger },
  pressed: { opacity: 0.78 },
});
