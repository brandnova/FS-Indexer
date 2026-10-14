import { Upload } from 'lucide-react-native';
import { useActions } from '../actions';
import { Button, Card, Text } from '../ui';

/** A card for the Home screen: the way into "send files to your PC". */
export default function SendToPcCard() {
  const { openUpload } = useActions();
  return (
    <Card style={{ gap: 10 }}>
      <Text variant="bodyStrong">Send files to your PC</Text>
      <Text variant="caption" tone="muted">
        Pick photos or documents on this phone and drop them into your PC's upload folder.
      </Text>
      <Button title="Choose files" variant="tonal" icon={Upload} onPress={openUpload} />
    </Card>
  );
}