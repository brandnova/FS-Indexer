import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { useReduceMotion } from '../hooks';
import { useTheme } from '../theme/ThemeProvider';

/** Placeholder rows shown while a list loads. The whole block pulses gently (and stays still on "reduce motion"). */
export function SkeletonRows({ count = 8 }: { count?: number }) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduce) {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, pulse]);

  return (
    <Animated.View style={{ opacity: pulse }} accessible accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ height: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surfaceAlt }} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ width: `${55 + ((i * 17) % 35)}%`, height: 12, borderRadius: 6, backgroundColor: colors.surfaceAlt }} />
            <View style={{ width: `${25 + ((i * 11) % 25)}%`, height: 10, borderRadius: 5, backgroundColor: colors.surfaceAlt }} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}