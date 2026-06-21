export const colors = {
  ink: '#140A2E',
  inkMuted: '#665E73',
  inkSubtle: '#91899D',
  surface: '#FFFFFF',
  surfaceSoft: '#F7F3FB',
  surfaceRaised: '#FCFAFF',
  border: '#E7DFF0',
  brand: '#3E1F63',
  brandPressed: '#2B1249',
  brandSoft: '#EEE5F8',
  accent: '#B8F000',
  accentPressed: '#9BD200',
  accentSoft: '#F1FFD2',
  success: '#1F7A4D',
  warning: '#B86800',
  danger: '#B42318',
  dangerSoft: '#FFE7E5',
  white: '#FFFFFF',
  shadow: 'rgba(31, 14, 57, 0.18)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  xl: 30,
  pill: 999,
} as const;

export const typography = {
  title: 34,
  heading: 24,
  subheading: 18,
  body: 16,
  small: 13,
  tiny: 11,
} as const;

export const shadows = {
  card: {
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 30,
    elevation: 8,
  },
  soft: {
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
} as const;
