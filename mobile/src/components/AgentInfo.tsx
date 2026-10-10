import { Check, Download, FolderOpen, Lock, Monitor, ShieldCheck, Wifi, X, type LucideIcon } from 'lucide-react-native';
import { useCallback, useState, type ReactNode } from 'react';
import { Linking, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LINKS } from '../links';
import { Button, Card, IconButton, Text, useTheme, useThemedStyles, type Palette } from '../ui';

const SHARES = [
  'The names of your files and folders',
  'Where they are, how big they are and when they changed',
  'Where your chosen folders live on your PC, so you can copy full paths',
];

const NEVER = [
  "What's inside your files",
  'Passwords and keys: names like .env, .ssh and *.pem are skipped',
  'Anything outside the folders it is set up to share',
  'Anything with the internet. It only talks to devices on your own network',
];

const STEPS = [
  { title: 'Get the agent', text: 'Download it and open it on your computer. It works on Windows, macOS and Linux.' },
  { title: 'Allow it through the firewall', text: 'If your computer asks, allow it on private networks, like your home Wi-Fi.' },
  { title: 'Scan the QR code', text: 'The agent shows a QR code. Scan it with this app, just once, and you are connected.' },
];

const GOOD_TO_KNOW: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: FolderOpen,
    title: 'Which folders?',
    text: 'By default your Documents, Downloads, Desktop, Pictures, Music and Videos. You can change this in the agent settings.',
  },
  {
    icon: Wifi,
    title: 'Same network',
    text: 'Your phone and computer need to be on the same Wi-Fi (or linked through a VPN) to update. After that you can search and browse without any connection.',
  },
  {
    icon: Lock,
    title: 'Who can connect?',
    text: 'Only phones that scanned your QR code. Everything else is turned away. The connection is not encrypted yet, so use it on networks you trust, like at home, rather than on public Wi-Fi.',
  },
  {
    icon: Monitor,
    title: 'Does it have to stay on?',
    text: 'Only while you update. Closing it deletes nothing on your phone or your computer.',
  },
  {
    icon: ShieldCheck,
    title: 'Removing it',
    text: 'Close and delete the agent. In this app, open Settings and tap Unpair to remove the saved connection and file list.',
  },
];

/** `const [open, element] = useAgentInfo()`: call open() to show the screen, and render `element` somewhere. */
export function useAgentInfo(): [() => void, ReactNode] {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  return [open, <AgentInfo key="agent-info" visible={visible} onClose={() => setVisible(false)} />];
}

function AgentInfo({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text variant="title" style={styles.flex}>
            About the agent
          </Text>
          <IconButton icon={X} label="Close" color={colors.text} onPress={onClose} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon} importantForAccessibility="no-hide-descendants">
              <Monitor size={40} color={colors.primary} />
            </View>
            <Text variant="heading" style={styles.center}>
              A small program that runs on your computer
            </Text>
            <Text tone="muted" style={styles.center}>
              It makes a list of the files in the folders you choose and shares that list with this app, over your own
              Wi-Fi, so you can search and browse your files from your phone.
            </Text>
          </View>

          <Card style={styles.cardGap}>
            <Text variant="heading">What it shares</Text>
            {SHARES.map((text) => (
              <Bullet key={text} ok text={text} />
            ))}
          </Card>

          <Card style={styles.cardGap}>
            <Text variant="heading">What it never shares</Text>
            {NEVER.map((text) => (
              <Bullet key={text} ok={false} text={text} />
            ))}
          </Card>

          <Card style={styles.cardGap}>
            <Text variant="heading">Set it up in three steps</Text>
            {STEPS.map((step, i) => (
              <View key={step.title} style={styles.row}>
                <View style={styles.stepBadge}>
                  <Text variant="label" tone="primary">
                    {i + 1}
                  </Text>
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyStrong">{step.title}</Text>
                  <Text variant="caption" tone="muted">
                    {step.text}
                  </Text>
                </View>
              </View>
            ))}
            {LINKS.agentDownload ? (
              <Button
                title="Open the download page"
                icon={Download}
                variant="tonal"
                size="sm"
                onPress={() => void Linking.openURL(LINKS.agentDownload)}
              />
            ) : null}
          </Card>

          <Text variant="label" tone="muted" accessibilityRole="header">
            GOOD TO KNOW
          </Text>
          <Card style={styles.cardGap}>
            {GOOD_TO_KNOW.map(({ icon: Icon, title, text }) => (
              <View key={title} style={styles.row}>
                <View style={styles.factIcon} importantForAccessibility="no-hide-descendants">
                  <Icon size={18} color={colors.primary} />
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyStrong">{title}</Text>
                  <Text variant="caption" tone="muted">
                    {text}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
          <Button title="Got it" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Bullet({ ok, text }: { ok: boolean; text: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row} accessible accessibilityLabel={`${ok ? 'Shares' : 'Never shares'}: ${text}`}>
      <View style={[styles.bulletIcon, { backgroundColor: ok ? colors.successSoft : colors.dangerSoft }]}>
        {ok ? <Check size={14} color={colors.success} /> : <X size={14} color={colors.danger} />}
      </View>
      <Text variant="caption" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    flex: { flex: 1 },
    center: { textAlign: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 12, paddingVertical: 8 },
    content: { padding: 20, paddingBottom: 24, gap: 16 },
    hero: { alignItems: 'center', gap: 10, paddingVertical: 8 },
    heroIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
    cardGap: { gap: 12 },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    bulletIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    stepBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
    factIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
    footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, backgroundColor: c.bg },
  });