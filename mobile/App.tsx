import {
  Nunito_400Regular,
  Nunito_600SemiBold,
  Nunito_700Bold,
  useFonts,
} from '@expo-google-fonts/nunito';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionsProvider } from './src/actions';
import TabBar, { type TabKey } from './src/components/TabBar';
import { getDb } from './src/db';
import { useKeyboardVisible } from './src/hooks';
import { loadPairing } from './src/pairing';
import { refreshPcRoots } from './src/pcPaths';
import FilesScreen, { type FilesHandle } from './src/screens/FilesScreen';
import HomeScreen from './src/screens/HomeScreen';
import ListScreen from './src/screens/ListScreen';
import PairScreen from './src/screens/PairScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { SessionProvider, useSession } from './src/session';
import { getThemeMode, type ThemeMode } from './src/settings';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import type { PairingInfo } from './src/types';

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold });
  const [mode, setMode] = useState<ThemeMode | null>(null);

  useEffect(() => {
    getThemeMode()
      .then(setMode)
      .catch(() => setMode('light'));
  }, []);

  // Wait for the saved theme and the fonts, so nothing flashes in the wrong look.
  if (mode === null || (!fontsLoaded && !fontError)) {
    return <View style={{ flex: 1, backgroundColor: mode === 'dark' ? '#0C1226' : '#F5F7FB' }} />;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider initialMode={mode}>
        <Root />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // undefined = still loading, null = not paired
  const [pairing, setPairing] = useState<PairingInfo | null | undefined>(undefined);

  useEffect(() => {
    loadPairing()
      .then(setPairing)
      .catch(() => setPairing(null));
    getDb().catch((e) => console.error('Database failed to open', e));
  }, []);

  // Learn where the PC's folders live (for "Copy PC path"). Quietly does nothing if the PC is offline.
  useEffect(() => {
    if (pairing) void refreshPcRoots(pairing);
  }, [pairing]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: insets.top,
        paddingBottom: pairing ? 0 : insets.bottom,
      }}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {pairing === undefined ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : pairing === null ? (
        <PairScreen onPaired={setPairing} />
      ) : (
        <SessionProvider pairing={pairing} onRelocated={setPairing}>
          <Shell onUnpaired={() => setPairing(null)} />
        </SessionProvider>
      )}
    </View>
  );
}

function Shell({ onUnpaired }: { onUnpaired: () => void }) {
  const { bump } = useSession();
  return (
    <ActionsProvider bump={bump}>
      <Tabs onUnpaired={onUnpaired} />
    </ActionsProvider>
  );
}

function Tabs({ onUnpaired }: { onUnpaired: () => void }) {
  const keyboardOpen = useKeyboardVisible();
  const [tab, setTab] = useState<TabKey>('home');
  const [visited, setVisited] = useState<Set<TabKey>>(() => new Set<TabKey>(['home']));
  const [filesPath, setFilesPath] = useState('');
  const [searchKey, setSearchKey] = useState(0);
  const filesRef = useRef<FilesHandle>(null);

  // Tabs are created the first time they're opened and then keep their state.
  const go = useCallback((next: TabKey) => {
    setTab(next);
    setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
  }, []);

  const openFolder = useCallback(
    (path: string) => {
      setFilesPath(path);
      go('files');
    },
    [go],
  );

  const startSearch = useCallback(() => {
    go('files');
    setSearchKey((k) => k + 1);
  }, [go]);

  // Android back: let the Files tab step out of a search or a folder first, then go Home, then leave the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab === 'files' && filesRef.current?.handleBack()) return true;
      if (tab !== 'home') {
        go('home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [tab, go]);

  const layer = (key: TabKey) => ({ flex: 1, display: tab === key ? ('flex' as const) : ('none' as const) });

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <View style={layer('home')}>
          <HomeScreen onSearch={startSearch} onOpenFolder={openFolder} onSeeAllRecent={() => go('recent')} />
        </View>
        {visited.has('files') ? (
          <View style={layer('files')}>
            <FilesScreen ref={filesRef} path={filesPath} onPathChange={setFilesPath} focusKey={searchKey} />
          </View>
        ) : null}
        {visited.has('recent') ? (
          <View style={layer('recent')}>
            <ListScreen kind="recent" onOpenFolder={openFolder} />
          </View>
        ) : null}
        {visited.has('pinned') ? (
          <View style={layer('pinned')}>
            <ListScreen kind="pinned" onOpenFolder={openFolder} />
          </View>
        ) : null}
        {visited.has('settings') ? (
          <View style={layer('settings')}>
            <SettingsScreen onUnpaired={onUnpaired} />
          </View>
        ) : null}
      </View>
      {keyboardOpen ? null : <TabBar tab={tab} onChange={go} />}
    </View>
  );
}