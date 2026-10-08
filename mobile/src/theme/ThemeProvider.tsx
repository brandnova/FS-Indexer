import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { setThemeMode, type ThemeMode } from '../settings';
import { dark, light, type Palette } from './tokens';

interface ThemeValue {
  colors: Palette;
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeValue>({
  colors: light,
  mode: 'light',
  isDark: false,
  setMode: () => {},
});

export function ThemeProvider({ initialMode, children }: { initialMode: ThemeMode; children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void setThemeMode(next); // remembered for the next launch
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ colors: mode === 'dark' ? dark : light, mode, isDark: mode === 'dark', setMode }),
    [mode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/**
 * Builds a StyleSheet from the current palette. Pass a factory defined at module
 * level (so its identity is stable); the styles are rebuilt only when the theme changes.
 */
export function useThemedStyles<T>(factory: (colors: Palette) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}