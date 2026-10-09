import { FolderSearch, Monitor, QrCode, Sparkles, type LucideIcon } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Text, useTheme, useThemedStyles, type Palette } from '../ui';

interface Props {
  onContinue: () => void; // go on to connect a PC
  onDemo: () => void; // try the sample files first
}

const PAGES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: FolderSearch,
    title: 'Find any file on your PC',
    text: "Search and browse your computer's files from your phone, even when you're not connected.",
  },
  {
    icon: Monitor,
    title: 'Add a small helper to your PC',
    text: 'A tiny program called the agent runs on your computer. It shares the names of your files with this app over your own Wi-Fi. Never the files themselves.',
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
        {PAGES.map(({ icon: Icon, title, text }) => (
          <View key={title} style={[styles.page, { width }]}>
            <View style={styles.iconCircle} importantForAccessibility="no-hide-descendants">
              <Icon size={48} color={colors.primary} />
            </View>
            <Text variant="display" style={styles.centered}>
              {title}
            </Text>
            <Text tone="muted" style={styles.centered}>
              {text}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots} accessibilityLabel={`Page ${index + 1} of ${PAGES.length}`} accessible>
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
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1 },
    top: { height: 52, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 12 },
    pager: { flex: 1 },
    page: { flex: 1, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center', gap: 16 },
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
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 16 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.border },
    dotActive: { width: 24, backgroundColor: c.primary },
    buttons: { paddingHorizontal: 24, paddingBottom: 28, gap: 10, minHeight: 124, justifyContent: 'flex-end' },
  });