import type { ComponentType, SVGProps } from 'react';

export type SiteIcon = ComponentType<SVGProps<SVGSVGElement>>;

function BaseIcon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ArrowRight: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </BaseIcon>
);

export const Menu: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </BaseIcon>
);

export const X: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="m6 6 12 12" />
    <path d="m18 6-12 12" />
  </BaseIcon>
);

export const Plus: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </BaseIcon>
);

export const Activity: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M3 12h4l3-7 4 14 3-7h4" />
  </BaseIcon>
);

export const BarChart3: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M4 20V10" />
    <path d="M12 20V4" />
    <path d="M20 20v-7" />
  </BaseIcon>
);

export const CalendarClock: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M7 3v3" />
    <path d="M17 3v3" />
    <path d="M4 8h16" />
    <path d="M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
    <path d="M15 14h-3v-3" />
  </BaseIcon>
);

export const CreditCard: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M4 7h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" />
    <path d="M3 10h18" />
    <path d="M7 15h4" />
  </BaseIcon>
);

export const FileCheck2: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M7 3h7l4 4v14H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v5h5" />
    <path d="m9 15 2 2 5-6" />
  </BaseIcon>
);

export const Landmark: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M3 9h18" />
    <path d="m12 3 8 6H4l8-6Z" />
    <path d="M5 9v9" />
    <path d="M9 9v9" />
    <path d="M15 9v9" />
    <path d="M19 9v9" />
    <path d="M3 21h18" />
  </BaseIcon>
);

export const Layers3: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12 9 5 9-5" />
    <path d="m3 16 9 5 9-5" />
  </BaseIcon>
);

export const LockKeyhole: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M7 11V8a5 5 0 0 1 10 0v3" />
    <path d="M5 11h14v10H5V11Z" />
    <path d="M12 15v2" />
  </BaseIcon>
);

export const ReceiptText: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
    <path d="M9 8h6" />
    <path d="M9 12h6" />
    <path d="M9 16h4" />
  </BaseIcon>
);

export const Check: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="m5 13 4 4 10-10" />
  </BaseIcon>
);

export const ShieldCheck: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
    <path d="m9 12 2 2 4-5" />
  </BaseIcon>
);

export const Sparkles: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
    <path d="M5 18v3" />
    <path d="M3.5 19.5h3" />
    <path d="M19 3v4" />
    <path d="M17 5h4" />
  </BaseIcon>
);

export const UsersRound: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
    <path d="M2 21a6 6 0 0 1 12 0" />
    <path d="M17 11a3 3 0 1 0 0-6" />
    <path d="M16 15a5 5 0 0 1 6 5" />
  </BaseIcon>
);

export const Workflow: SiteIcon = (props) => (
  <BaseIcon {...props}>
    <path d="M5 6h4v4H5V6Z" />
    <path d="M15 14h4v4h-4v-4Z" />
    <path d="M9 8h4a3 3 0 0 1 3 3v3" />
    <path d="M12 16H9a3 3 0 0 1-3-3v-3" />
  </BaseIcon>
);
