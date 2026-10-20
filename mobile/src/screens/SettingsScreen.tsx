import Constants from 'expo-constants';
import { Download, FolderOpen, Info, Moon, Monitor, Settings as SettingsIcon, Sun, Unlink, Wifi, ExternalLink, Mail } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Alert, ScrollView, Linking, StyleSheet, Switch, View } from 'react-native';
import { useActions } from '../actions';
import { useAgentInfo } from '../components/AgentInfo';
import BrandFooter from '../components/BrandFooter';
import TrustNotice from '../components/TrustNotice';
import { clearDownloads, summarize, useDownloads } from '../downloadQueue';
import { formatRelative } from '../format';
import { unpair } from '../pairing';
import { platform } from '../platform';
import { useSession } from '../session';
import type { ThemeMode } from '../settings';
import { BRAND } from '../brand';
import { ActionRow, Button, Card, SegmentedControl, StatusChip, Text, useTheme, useThemedStyles, type Palette } from '../ui';

export default function SettingsScreen({ onUnpaired }: { onUnpaired: () => void }) {
  const s = useSession();
  const { mode, setMode, colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [openAgentInfo, agentInfoModal] = useAgentInfo();
  const { openDownloads } = useActions();
  const downloads = useDownloads();
  const dl = summarize(downloads);
  const online = s.remote !== null;
  const demo = s.pairing.demo === true;

  const downloadsSubtitle = dl.running
  ? `${dl.active + dl.queued} in progress · ${dl.done} saved`
  : downloads.length > 0
  ? `${dl.done} saved${dl.failed ? ` · ${dl.failed} failed` : ''}`
  : 'Files you download from your PC appear here';

  async function leave() {
    await clearDownloads(); // the history holds file names from the PC
    await unpair();
    onUnpaired();
  }

  function confirmUnpair() {
    Alert.alert(
      'Unpair this PC?',
      'The saved connection, the file list on this phone, your pinned folders and your downloads list will be deleted. Nothing on your PC changes, and files already saved in Downloads stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unpair', style: 'destructive', onPress: () => void leave() },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <Text variant="title">Settings</Text>

    {demo ? (
      <Section title="Demo">
      <Card style={styles.cardGap}>
      <Text>You're exploring sample files stored on this phone. Nothing is connected to a real PC.</Text>
      <Button title="Connect my own PC" icon={Monitor} onPress={() => void leave()} />
      </Card>
      </Section>
    ) : (
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
    )}

    <TrustNotice compact />

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
    accessibilityLabel="Update when I open the app"
    trackColor={{ false: colors.border, true: colors.primary }}
    thumbColor="#FFFFFF"
    />
    </View>

    <View style={styles.divider} />

    <InfoRow label="Last updated" value={s.lastSynced ? formatRelative(s.lastSynced) : 'never'} />
    <InfoRow label="Files on this phone" value={s.localCount === null ? '...' : s.localCount.toLocaleString()} />
    {s.remote && !demo ? <InfoRow label="Files on your PC" value={s.remote.file_count.toLocaleString()} /> : null}

    <ActionRow
    icon={Download}
    title="Quick update"
    subtitle="Copy the list your PC already has, without asking it to rescan"
    onPress={() => void s.runSync({ rescan: false })}
    />
    </Card>
    </Section>

    {demo ? null : (
      <Section title="Downloads">
      <Card>
      <ActionRow icon={FolderOpen} title="Downloads" subtitle={downloadsSubtitle} onPress={openDownloads} />
      </Card>
      </Section>
    )}

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

    {demo ? null : (
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
    )}

    <Section title="About">
    <Card style={styles.cardGap}>
    <InfoRow label="App version" value={Constants.expoConfig?.version ?? '-'} />
    {demo ? null : <InfoRow label="Agent version" value={s.remote?.version ?? '-'} />}
    <ActionRow
    icon={Info}
    title="About the agent"
    subtitle="What it is and what it shares"
    onPress={openAgentInfo}
    />
    <ActionRow
    icon={Mail}
    title="Contact support"
    subtitle={BRAND.supportEmail}
    onPress={() => void Linking.openURL(`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent('Problem with the app')}`).catch(() => {})}
    />
    <ActionRow
    icon={ExternalLink}
    title="Report on GitHub"
    subtitle="Open an issue"
    onPress={() => void Linking.openURL(BRAND.issuesUrl).catch(() => {})}
    />
    <BrandFooter />
    </Card>
    </Section>

    {demo ? (
      <Button title="Exit the demo" icon={Unlink} variant="danger" onPress={() => void leave()} />
    ) : (
      <Button title="Unpair this PC" icon={Unlink} variant="danger" onPress={confirmUnpair} />
    )}

    {agentInfoModal}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
    <Text variant="label" tone="muted" accessibilityRole="header">
    {title.toUpperCase()}
    </Text>
    {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View
    accessible
    accessibilityLabel={`${label}: ${value}`}
    style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
    >
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
