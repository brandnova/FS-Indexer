import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { getDb } from './src/db';
import { loadPairing } from './src/pairing';
import BrowseScreen from './src/screens/BrowseScreen';
import HomeScreen from './src/screens/HomeScreen';
import PairScreen from './src/screens/PairScreen';
import type { PairingInfo } from './src/types';
import { colors } from './src/ui';

export default function App() {
  // undefined = still loading, null = not paired
  const [pairing, setPairing] = useState<PairingInfo | null | undefined>(undefined);
  const [route, setRoute] = useState<'home' | 'browse'>('home');

  useEffect(() => {
    loadPairing()
      .then(setPairing)
      .catch(() => setPairing(null));
    getDb().catch((e) => console.error('Database failed to open', e));
  }, []);

  let content;
  if (pairing === undefined) {
    content = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  } else if (pairing === null) {
    content = <PairScreen onPaired={setPairing} />;
  } else if (route === 'browse') {
    content = <BrowseScreen pairing={pairing} onBack={() => setRoute('home')} />;
  } else {
    content = (
      <HomeScreen
        pairing={pairing}
        onBrowse={() => setRoute('browse')}
        onRelocated={setPairing}
        onUnpaired={() => {
          setRoute('home');
          setPairing(null);
        }}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        {content}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});