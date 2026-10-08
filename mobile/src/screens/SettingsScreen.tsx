import Constants from 'expo-constants';
import { Download, Moon, Monitor, Settings as SettingsIcon, Sun, Unlink, Wifi } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { formatRelative } from '../format';
import { unpair } from '../pairing';
import { platform } from '../platform';
import { useSession } from '../session';
import type { ThemeMode } from '../settings';
import { ActionRow, Button, Card, SegmentedControl, StatusChip, Text, useTheme, useThemedStyles, type Palette } from '../ui';

export default function SettingsScreen({ onUnpaired }: { onUnpaired: () => void }) {
  const s = useSession();
  const { mode, setMode, colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const online = s.remote !== null;

  function confirmUnpair() {
    Alert.alert(
      'Unpair this PC?',
      'The saved connection, the file list on this phone and your pinned folders will be deleted. Nothing on your PC changes.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: async () => {
            await unpair();
            onUnpaired();
          },
        },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text variant="title">Settings</Text>

      <Section title="Your PC">
        <Card style={styles.cardGap}>
          <View style={styles.pcRow}>
            <View style={styles.pcIcon}>
              <Monitor size={22} color={colors.primary} />
            </View>
            <View style={styles.flex}>
              <Text variant="heading" numberOfLines={1}>
                {s.pairing.name}
              </Text>
              <Text variant="caption" tone="muted">
                {s.pairing.host}:{s.pairing.port}
              </Text>
            </View>
            <StatusChip
              kind={s.checking ? 'idle' : online ? 'ok' : 'bad'}
              label={s.checking ? 'Checking' : online ? 'Connected' : 'Offline'}
            />
          </View>
          <Button title="Check connection" icon={Wifi} variant="secondary" loading={s.checking} onPress={() => void s.check()} />
        </Card>
      </Section>

      <Section title="Updates">
        <Card style={styles.cardGap}>
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text variant="bodyStrong">Update when I open the app</Text>
              <Text variant="caption" tone="muted">
                Only when your PC has newer files. If your last update is over 6 hours old, your PC rescans first.
              </Text>
            </View>
            <Switch
              value={s.autoSyncOn}
              onValueChange={s.setAutoSyncOn}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={styles.divider} />

          <InfoRow label="Last updated" value={s.lastSynced ? formatRelative(s.lastSynced) : 'never'} />
          <InfoRow label="Files on this phone" value={s.localCount === null ? '...' : s.localCount.toLocaleString()} />
          {s.remote ? <InfoRow label="Files on your PC" value={s.remote.file_count.toLocaleString()} /> : null}

          <ActionRow
            icon={Download}
            title="Quick update"
            subtitle="Copy the list your PC already has, without asking it to rescan"
            onPress={() => void s.runSync({ rescan: false })}
          />
        </Card>
      </Section>

      <Section title="Appearance">
        <Card>
          <SegmentedControl<ThemeMode>
            options={[
              { key: 'light', label: 'Light', icon: Sun },
              { key: 'dark', label: 'Dark', icon: Moon },
            ]}
            value={mode}
            onChange={setMode}
          />
        </Card>
      </Section>

      <Section title="Can't connect?">
        <Card style={styles.cardGap}>
          <Text>{platform.connectionHelp}</Text>
          <Button
            title="Open network settings"
            icon={SettingsIcon}
            variant="secondary"
            onPress={() => void platform.openNetworkSettings()}
          />
        </Card>
      </Section>

      <Section title="About">
        <Card style={styles.cardGap}>
          <InfoRow label="App version" value={Constants.expoConfig?.version ?? '-'} />
          <InfoRow label="Agent version" value={s.remote?.version ?? '-'} />
        </Card>
      </Section>

      <Button title="Unpair this PC" icon={Unlink} variant="danger" onPress={confirmUnpair} />
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text variant="label" tone="muted">
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <Text tone="muted">{label}</Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: 20, paddingBottom: 32, gap: 20 },
    flex: { flex: 1 },
    cardGap: { gap: 14 },
    pcRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    pcIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySoft },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.border },
  });