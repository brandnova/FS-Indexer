import { Platform } from 'react-native';

/** A friendly name for this phone. The PC shows it in its list of paired phones. */
export function deviceName(): string {
  if (Platform.OS === 'android') {
    const c = Platform.constants as { Manufacturer?: string; Brand?: string; Model?: string };
    const maker = String(c.Manufacturer ?? c.Brand ?? '').trim();
    const model = String(c.Model ?? '').trim();
    const name = model.toLowerCase().startsWith(maker.toLowerCase()) ? model : `${maker} ${model}`;
    return name.trim() || 'Android phone';
  }
  if (Platform.OS === 'ios') return (Platform as { isPad?: boolean }).isPad ? 'iPad' : 'iPhone';
  return 'Phone';
}