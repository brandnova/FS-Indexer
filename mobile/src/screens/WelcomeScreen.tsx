import { Check, FolderSearch, Monitor, QrCode, Sparkles, X, type LucideIcon } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useAgentInfo } from '../components/AgentInfo';
import { Button, Text, useTheme, useThemedStyles, type Palette } from '../ui';

interface Props {
  onContinue: () => void; // go on to connect a PC
  onDemo: () => void; // try the sample files first
}

interface Page {
  icon: LucideIcon;
  title: string;
  text: string;
  bullets?: { ok: boolean; text: string }[];
  more?: boolean; // offer the "About the agent" screen
}

const PAGES: Page[] = [
  {
    icon: FolderSearch,
    title: 'Find any file on your PC',
    text: "Search and browse your computer's files from your phone, even when you're not connected.",
  },
  {
    icon: Monitor,
    title: 'Add a small helper to your PC',
    text: 'The agent is a tiny program that runs on your computer and shares a list of your file names with this app, over your own Wi-Fi.',
    bullets: [
      { ok: true, text: 'Shares file names, sizes and dates' },
      { ok: false, text: "Never shares what's inside your files" },
      { ok: false, text: 'Nothing goes to the internet' },
    ],
    more: true,
  },
  {
    icon: QrCode,
    title: 'Scan once to connect',
    text: 'The agent shows a QR code. Scan it with this app and you are connected. Only file names are copied to your phone.',
  },
];

export default function WelcomeScreen({ onContinue, onDemo }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [openAgentInfo, agentInfoModal] = useAgentInfo();
  const last = index === PAGES.length - 1;

  const next = () => scroller.current?.scrollTo({ x: width * (index + 1), animated: true });

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        {last ? null : <Button title="Skip" variant="ghost" size="sm" onPress={onContinue} />}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {PAGES.map(({ icon: Icon, title, text, bullets, more }) => (
          // Each page scrolls by itself, so big system fonts can't push content off the screen.
          <ScrollView
            key={title}
            style={{ width }}
            contentContainerStyle={styles.pageContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.iconCircle} importantForAccessibility="no-hide-descendants">
              <Icon size={48} color={colors.primary} />
            </View>
            <Text variant="display" style={styles.centered}>
              {title}
            </Text>
            <Text tone="muted" style={styles.centered}>
              {text}
            </Text>

            {bullets ? (
              <View style={styles.bullets}>
                {bullets.map((b) => (
                  <View key={b.text} style={styles.bullet}>
                    <View style={[styles.bulletIcon, { backgroundColor: b.ok ? colors.successSoft : colors.dangerSoft }]}>
                      {b.ok ? <Check size={14} color={colors.success} /> : <X size={14} color={colors.danger} />}
                    </View>
                    <Text variant="caption" style={styles.flex}>
                      {b.text}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {more ? (
              <Button title="What does the agent share?" variant="tonal" size="sm" onPress={openAgentInfo} />
            ) : null}
          </ScrollView>
        ))}
      </ScrollView>

      <View style={styles.dots} accessible accessibilityLabel={`Page ${index + 1} of ${PAGES.length}`}>
        {PAGES.map((page, i) => (
          <View key={page.title} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.buttons}>
        {last ? (
          <>
            <Button title="Connect my PC" onPress={onContinue} />
            <Button title="Try the demo first" variant="tonal" icon={Sparkles} onPress={onDemo} />
          </>
        ) : (
          <Button title="Next" onPress={next} />
        )}
      </View>

      {agentInfoModal}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1 },
    flex: { flex: 1 },
    top: { height: 52, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 12 },
    pager: { flex: 1 },
    pageContent: {
      flexGrow: 1,
      paddingHorizontal: 32,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    },
    iconCircle: {
      width: 112,
      height: 112,
      borderRadius: 56,
      backgroundColor: c.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    centered: { textAlign: 'center' },
    bullets: { alignSelf: 'stretch', gap: 10, paddingVertical: 4 },
    bullet: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    bulletIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 16 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.border },
    dotActive: { width: 24, backgroundColor: c.primary },
    buttons: { paddingHorizontal: 24, paddingBottom: 28, gap: 10, minHeight: 124, justifyContent: 'flex-end' },
  });