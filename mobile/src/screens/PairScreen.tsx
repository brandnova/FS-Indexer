import { CameraView, useCameraPermissions } from 'expo-camera';
import { ChevronRight, Folder, Monitor, QrCode, Sparkles, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ApiError, toApiError } from '../api/client';
import { startDiscovery, type DiscoveredDevice } from '../discovery';
import { pairWith, parseAddress, parseQrPayload } from '../pairing';
import { platform } from '../platform';
import type { Candidate, PairingInfo } from '../types';
import { Button, Card, Text, fonts, radius, useTheme, useThemedStyles, type Palette } from '../ui';

interface Props {
  onPaired: (info: PairingInfo) => void;
  onDemo: () => void;
}

export default function PairScreen({ onPaired, onDemo }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [mode, setMode] = useState<'form' | 'scan'>('form');
  const [showManual, setShowManual] = useState(false);
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | string | null>(null);

  const [nearby, setNearby] = useState<DiscoveredDevice[]>([]);
  const [discoverySupported, setDiscoverySupported] = useState(false);
  const [expected, setExpected] = useState<DiscoveredDevice | null>(null);

  // Look for PCs while the form is showing; stop while the camera is open.
  useEffect(() => {
    if (mode !== 'form') return undefined;
    const session = startDiscovery(setNearby);
    setDiscoverySupported(session !== null);
    return () => session?.stop();
  }, [mode]);

  async function connect(c: Candidate) {
    setBusy(true);
    setError(null);
    try {
      onPaired(await pairWith(c));
    } catch (e) {
      setError(toApiError(e));
      setBusy(false);
    }
  }

  function submitManual() {
    const addr = parseAddress(address);
    if (!addr) {
      setError('Enter the PC address like 192.168.1.23:8080');
      return;
    }
    if (!token.trim()) {
      setError('Enter the token shown by the agent.');
      return;
    }
    void connect({ ...addr, token: token.trim() });
  }

  function handleScan(data: string) {
    setMode('form');
    const candidate = parseQrPayload(data);
    if (!candidate) {
      setError("That QR code isn't a pairing code from the agent.");
      return;
    }
    if (expected && candidate.id && candidate.id !== expected.id) {
      setError(`That QR code belongs to a different PC, not ${expected.name}.`);
      return;
    }
    setExpected(null);
    void connect(candidate);
  }

  if (mode === 'scan') {
    return (
      <Scanner
        hint={expected ? `Scan the QR code shown by ${expected.name}` : "Point the camera at the QR code on your PC's screen"}
        onResult={handleScan}
        onCancel={() => {
          setExpected(null);
          setMode('form');
        }}
      />
    );
  }

  const errorText = typeof error === 'string' ? error : error?.message;
  const showHelp = error instanceof ApiError && error.isConnectivity;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.brand} importantForAccessibility="no-hide-descendants">
        <Folder size={34} color={colors.folder} />
      </View>

      <View style={styles.titles}>
        <Text variant="display">Connect to your PC</Text>
        <Text tone="muted">
          Start the agent on your computer. It shows a QR code: scan it here and your files are one tap away.
        </Text>
      </View>

      <Button
        title="Scan QR code"
        icon={QrCode}
        disabled={busy}
        onPress={() => {
          setError(null);
          setExpected(null);
          setMode('scan');
        }}
      />

      {discoverySupported ? (
        <View style={styles.nearby}>
          <Text variant="label" tone="muted" accessibilityRole="header">
            NEARBY PCS
          </Text>
          {nearby.length === 0 ? (
            <View style={styles.inline}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text variant="caption" tone="muted">
                Looking for PCs running the agent...
              </Text>
            </View>
          ) : (
            nearby.map((d) => (
              <Pressable
                key={d.id}
                style={styles.nearbyRow}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`${d.name}. Tap, then scan the QR code it shows`}
                onPress={() => {
                  setError(null);
                  setExpected(d);
                  setMode('scan');
                }}
              >
                <View style={styles.nearbyIcon}>
                  <Monitor size={20} color={colors.primary} />
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyStrong">{d.name}</Text>
                  <Text variant="caption" tone="muted">
                    Tap, then scan the QR code it shows
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.muted} />
              </Pressable>
            ))
          )}
        </View>
      ) : null}

      <Button
        title={showManual ? 'Hide manual entry' : 'Enter details manually'}
        variant="ghost"
        onPress={() => setShowManual((v) => !v)}
      />

      {showManual ? (
        <Card style={styles.manual}>
          <Text variant="label" tone="muted">
            PC ADDRESS
          </Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="192.168.1.23:8080"
            placeholderTextColor={colors.muted}
            accessibilityLabel="PC address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          <Text variant="label" tone="muted">
            TOKEN
          </Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder="The token shown by the agent"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Token"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          <Button title="Connect" loading={busy} onPress={submitManual} />
        </Card>
      ) : null}

      {errorText ? (
        <View style={styles.errorBox} accessibilityLiveRegion="polite">
          <Text tone="danger">{errorText}</Text>
        </View>
      ) : null}

      {showHelp ? (
        <Card style={styles.manual}>
          <Text>{platform.connectionHelp}</Text>
          <Button title="Open network settings" variant="secondary" size="sm" onPress={() => void platform.openNetworkSettings()} />
        </Card>
      ) : null}

      {busy && !showManual ? <ActivityIndicator color={colors.primary} /> : null}

      <View style={styles.demoBox}>
        <Text variant="caption" tone="muted" style={styles.centered}>
          No PC handy? Look around with some sample files first.
        </Text>
        <Button title="Try the demo" variant="tonal" icon={Sparkles} disabled={busy} onPress={onDemo} />
      </View>
    </ScrollView>
  );
}

function Scanner({
  hint,
  onResult,
  onCancel,
}: {
  hint: string;
  onResult: (data: string) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false); // the camera fires repeatedly; only react once

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text variant="title" style={styles.centered}>
          Camera access needed
        </Text>
        <Text tone="muted" style={styles.centered}>
          The camera is only used to scan the pairing QR code. Nothing is saved or sent anywhere.
        </Text>
        <View style={styles.centerButtons}>
          <Button title="Allow camera" onPress={() => void requestPermission()} />
          <Button title="Cancel" variant="secondary" icon={X} onPress={onCancel} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.scanner}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          handled.current = true;
          onResult(data);
        }}
      />
      <View style={styles.scanFooter}>
        <Text variant="bodyStrong" style={styles.scanHint}>
          {hint}
        </Text>
        <Button title="Cancel" variant="secondary" icon={X} onPress={onCancel} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: 24, paddingBottom: 40, gap: 18 },
    flex: { flex: 1 },
    centered: { textAlign: 'center' },
    brand: {
      width: 72,
      height: 72,
      borderRadius: 22,
      backgroundColor: c.navy,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
    },
    titles: { gap: 8 },
    nearby: { gap: 10 },
    inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    nearbyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: radius.lg,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    nearbyIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySoft },
    manual: { gap: 10 },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      fontFamily: fonts.regular,
      color: c.text,
    },
    errorBox: { padding: 14, borderRadius: radius.md, backgroundColor: c.dangerSoft },
    demoBox: { gap: 10, marginTop: 8 },
    center: { flex: 1, padding: 24, justifyContent: 'center', gap: 14 },
    centerButtons: { gap: 10, marginTop: 8 },
    scanner: { flex: 1, backgroundColor: '#000' },
    scanFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 24, gap: 14, backgroundColor: 'rgba(0,0,0,0.6)' },
    scanHint: { color: '#FFFFFF', textAlign: 'center' },
  });