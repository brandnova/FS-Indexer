import { CameraView, useCameraPermissions } from 'expo-camera';
import { ChevronRight, Monitor, QrCode, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, toApiError } from '../api/client';
import { startDiscovery, type DiscoveredDevice } from '../discovery';
import { pairWith, parseAddress, parseQrPayload } from '../pairing';
import { platform } from '../platform';
import type { Candidate, PairingInfo } from '../types';
import { Button, colors } from '../ui';

interface Props {
  onPaired: (info: PairingInfo) => void;
}

export default function PairScreen({ onPaired }: Props) {
  const [mode, setMode] = useState<'form' | 'scan'>('form');
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
    connect({ ...addr, token: token.trim() });
  }

  function handleScan(data: string) {
    setMode('form');
    const candidate = parseQrPayload(data);
    if (!candidate) {
      setError('That QR code is not a pairing code from the FS agent.');
      return;
    }
    if (expected && candidate.id && candidate.id !== expected.id) {
      setError(`That QR code belongs to a different PC, not ${expected.name}.`);
      return;
    }
    setExpected(null);
    connect(candidate);
  }

  if (mode === 'scan') {
    return (
      <Scanner
        hint={expected ? `Scan the QR code shown by ${expected.name}` : "Point the camera at the QR code in your PC's terminal"}
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
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Pair with your PC</Text>
      <Text style={styles.subtitle}>
        Start the agent on your PC, then scan the QR code it prints, or enter the details by hand.
      </Text>

      <Button
        title="Scan QR code"
        icon={QrCode}
        onPress={() => {
          setError(null);
          setExpected(null);
          setMode('scan');
        }}
        disabled={busy}
      />

      {discoverySupported ? (
        <View style={styles.nearby}>
          <Text style={styles.sectionTitle}>Nearby PCs</Text>
          {nearby.length === 0 ? (
            <View style={styles.inline}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.muted}>Looking for PCs running the agent...</Text>
            </View>
          ) : (
            nearby.map((d) => (
              <Pressable
                key={d.id}
                style={styles.nearbyRow}
                disabled={busy}
                onPress={() => {
                  setError(null);
                  setExpected(d);
                  setMode('scan');
                }}
              >
                <Monitor size={22} color={colors.primary} />
                <View style={styles.nearbyText}>
                  <Text style={styles.nearbyName}>{d.name}</Text>
                  <Text style={styles.muted}>Tap, then scan the QR code it shows</Text>
                </View>
                <ChevronRight size={18} color={colors.muted} />
              </Pressable>
            ))
          )}
        </View>
      ) : null}

      <Text style={styles.divider}>or enter manually</Text>

      <Text style={styles.label}>PC address</Text>
      <TextInput
        style={styles.input}
        value={address}
        onChangeText={setAddress}
        placeholder="192.168.1.23:8080"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />

      <Text style={styles.label}>Token</Text>
      <TextInput
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="Token from the agent"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
      />

      {busy ? (
        <ActivityIndicator style={styles.spinner} color={colors.primary} />
      ) : (
        <Button title="Connect" onPress={submitManual} />
      )}

      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

      {showHelp ? (
        <View style={styles.help}>
          <Text style={styles.helpText}>{platform.connectionHelp}</Text>
          <Button title="Open settings" variant="secondary" onPress={() => platform.openNetworkSettings()} />
        </View>
      ) : null}
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
        <Text style={styles.subtitle}>Camera access is needed to scan the pairing QR code.</Text>
        <View style={styles.gap}>
          <Button title="Allow camera" onPress={() => requestPermission()} />
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
        <Text style={styles.scanHint}>{hint}</Text>
        <Button title="Cancel" variant="secondary" icon={X} onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 8 },
  center: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 },
  gap: { gap: 12 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginTop: 8 },
  subtitle: { fontSize: 15, color: colors.muted, marginBottom: 16 },
  muted: { fontSize: 13, color: colors.muted },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nearby: { marginTop: 16, gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  nearbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  nearbyText: { flex: 1 },
  nearbyName: { fontSize: 16, fontWeight: '600', color: colors.text },
  divider: { textAlign: 'center', color: colors.muted, marginVertical: 16 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginBottom: 8,
  },
  spinner: { marginVertical: 14 },
  error: { color: colors.danger, marginTop: 12, fontSize: 14 },
  help: { marginTop: 12, gap: 12, padding: 14, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  helpText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  scanner: { flex: 1, backgroundColor: '#000' },
  scanFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 24, gap: 12, backgroundColor: 'rgba(0,0,0,0.55)' },
  scanHint: { color: '#fff', textAlign: 'center', fontSize: 15 },
});