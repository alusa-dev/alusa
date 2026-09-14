import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, type DimensionValue, type StyleProp, type ViewStyle, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme/tokens';

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  maxHeight?: DimensionValue;
  sheetStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function BottomSheet({
  visible,
  onClose,
  children,
  maxHeight = '86%',
  sheetStyle,
  accessibilityLabel = 'Janela inferior',
}: BottomSheetProps) {
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const sheetOffset = useSharedValue(height);
  const dragY = useSharedValue(0);
  const isDismissing = useSharedValue(false);

  useEffect(() => {
    if (visible) {
      if (!mounted) {
        setMounted(true);
        return undefined;
      }

      sheetOffset.value = height;
      dragY.value = 0;
      isDismissing.value = false;
      sheetOffset.value = withTiming(0, { duration: 220 });
      return undefined;
    }

    if (!mounted) return undefined;

    sheetOffset.value = withTiming(height, { duration: 180 }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
    return undefined;
  }, [dragY, height, isDismissing, mounted, sheetOffset, visible]);

  const closeFromGesture = useCallback(() => onClose(), [onClose]);
  const dismissThreshold = Math.min(180, Math.max(96, height * 0.2));
  const panGesture = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetX([-24, 24])
    .maxPointers(1)
    .onUpdate((event) => {
      if (isDismissing.value) return;
      dragY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (isDismissing.value) return;

      const shouldDismiss = event.translationY >= dismissThreshold || event.velocityY >= 1000;
      if (shouldDismiss) {
        isDismissing.value = true;
        dragY.value = withTiming(height, { duration: 180 }, (finished) => {
          if (finished) runOnJS(closeFromGesture)();
        });
        return;
      }

      dragY.value = withSpring(0, { damping: 22, stiffness: 220, mass: 0.9 });
    })
    .onFinalize(() => {
      if (!isDismissing.value) {
        dragY.value = withSpring(0, { damping: 22, stiffness: 220, mass: 0.9 });
      }
    });

  const sheetStyleAnimated = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.min(height, sheetOffset.value + dragY.value) }],
  }));
  const backdropStyleAnimated = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - (sheetOffset.value + dragY.value) / height),
  }));

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        <Reanimated.View style={[styles.backdrop, backdropStyleAnimated]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar" style={StyleSheet.absoluteFill} onPress={onClose} />
        </Reanimated.View>
        <Reanimated.View
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Deslize a janela para baixo para fechar"
          accessibilityActions={[{ name: 'escape', label: 'Fechar' }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === 'escape') onClose();
          }}
          style={[styles.sheet, { maxHeight }, sheetStyleAnimated, sheetStyle]}
        >
          <GestureDetector gesture={panGesture}>
            <View
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel="Controle da janela inferior"
              accessibilityHint="Deslize para baixo para fechar"
              style={styles.handleTouchTarget}
            >
              <View pointerEvents="none" style={styles.handle} />
            </View>
          </GestureDetector>
          {children}
        </Reanimated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0, 0, 0, 0.58)' },
  sheet: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    gap: spacing.lg,
    padding: spacing.xl,
    paddingTop: spacing['3xl'],
    paddingBottom: spacing['2xl'],
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  handleTouchTarget: {
    position: 'absolute',
    top: spacing.sm,
    right: 0,
    left: 0,
    zIndex: 1,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
});
