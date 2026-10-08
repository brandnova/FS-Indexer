/**
 * Copies text to the clipboard. Returns false if the native module isn't part
 * of this build (loaded lazily, so everything else still runs without it).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const Clipboard = require('expo-clipboard');
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}