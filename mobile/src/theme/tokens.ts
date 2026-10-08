export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  onPrimary: string;
  primarySoft: string;
  folder: string;
  folderSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  overlay: string;
  navy: string;
}

// Soft solid colours taken from the app icon: navy, amber folder, blue laptop, green phone.
export const light: Palette = {
  bg: '#F5F7FB',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF0F7',
  text: '#14213D',
  muted: '#5B678A',
  border: '#E2E7F1',
  primary: '#2F66E0',
  onPrimary: '#FFFFFF',
  primarySoft: '#E6EDFC',
  folder: '#F5A524',
  folderSoft: '#FFF1D6',
  success: '#1B9A6C',
  successSoft: '#E0F4EB',
  warning: '#B7791F',
  warningSoft: '#FFF3DB',
  danger: '#D14343',
  dangerSoft: '#FCE8E8',
  overlay: 'rgba(11,18,48,0.45)',
  navy: '#0B1230',
};

export const dark: Palette = {
  bg: '#0C1226',
  surface: '#151D36',
  surfaceAlt: '#1C2645',
  text: '#EBF0FC',
  muted: '#9AA6C4',
  border: '#27325A',
  primary: '#6C98FF',
  onPrimary: '#0C1226',
  primarySoft: '#1F2E5C',
  folder: '#F5B84A',
  folderSoft: '#3A2F17',
  success: '#3DCB96',
  successSoft: '#143A2E',
  warning: '#E5B04C',
  warningSoft: '#3A2F17',
  danger: '#FF7B7B',
  dangerSoft: '#432127',
  overlay: 'rgba(0,0,0,0.6)',
  navy: '#0B1230',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };

// Family names come from @expo-google-fonts/nunito (loaded in App.tsx).
export const fonts = {
  regular: 'Nunito_400Regular',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
};

export type TextVariant = 'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'label' | 'caption';

export const typography: Record<TextVariant, { fontFamily: string; fontSize: number; lineHeight: number }> = {
  display: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34 },
  title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 23 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
};