import { Linking, Platform } from 'react-native';

/**
 * Everything that differs between Android and iOS lives here, behind one
 * interface. Screens never check Platform.OS themselves.
 *
 * When an adapter grows (e.g. mDNS in Phase 6), split it into
 * `thing.ios.ts` / `thing.android.ts` files: Metro picks the right one
 * automatically when you import './thing'.
 */
export interface PlatformAdapter {
  /** Troubleshooting text shown when the PC can't be reached. */
  connectionHelp: string;
  /** Opens the most useful settings screen for fixing connectivity. */
  openNetworkSettings(): Promise<void>;
}

const ios: PlatformAdapter = {
  connectionHelp:
    'Make sure this phone is on the same Wi-Fi as your PC and that Local Network access is allowed for this app (Settings, then this app, then Local Network).',
  openNetworkSettings: () => Linking.openSettings(),
};

const android: PlatformAdapter = {
  connectionHelp:
    'Make sure this phone is on the same Wi-Fi as your PC. If that Wi-Fi has no internet, Android may send traffic over mobile data instead, so try turning mobile data off.',
  openNetworkSettings: () => Linking.sendIntent('android.settings.WIFI_SETTINGS'),
};

export const platform: PlatformAdapter = Platform.select({ ios, android, default: android });