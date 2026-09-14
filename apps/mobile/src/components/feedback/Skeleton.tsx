import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, type DimensionValue, type ViewStyle } from 'react-native';

import { colors, radius } from '@/theme/tokens';

type SkeletonProps = {
  width?: DimensionValue;
  height: number;
  radius?: number;
  style?: ViewStyle;
};

export function Skeleton({ width = '100%', height, radius: cornerRadius = radius.sm, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.48)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.82, duration: 850, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.48, duration: 850, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <Animated.View style={[styles.base, { width, height, borderRadius: cornerRadius, opacity }, style]} />;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surfaceNeutral,
  },
});
