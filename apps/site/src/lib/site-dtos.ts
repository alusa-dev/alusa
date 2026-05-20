import type { SiteIcon } from '@/components/icons/icons';

export type RouteDto = {
  readonly label: string;
  readonly href: string;
};

export type CtaDto = RouteDto & {
  readonly variant: 'primary' | 'secondary' | 'ghost';
};

export type CapabilityDto = {
  readonly title: string;
  readonly description: string;
  readonly icon: SiteIcon;
};

export type TrustItemDto = {
  readonly title: string;
  readonly body: string;
};

export type FooterGroupDto = {
  readonly title: string;
  readonly links: readonly RouteDto[];
};

export type FlowStepDto = {
  readonly label: string;
  readonly icon: SiteIcon;
};

export type HomePageDto = {
  readonly hero: {
    readonly title: string;
    readonly accent: string;
    readonly description: string;
    readonly ctas: readonly CtaDto[];
  };
  readonly proof: {
    readonly label: string;
    readonly items: readonly string[];
  };
  readonly problem: {
    readonly title: string;
    readonly body: readonly string[];
    readonly items: readonly string[];
  };
  readonly modules: readonly CapabilityDto[];
  readonly financial: {
    readonly title: string;
    readonly body: string;
  };
  readonly automation: {
    readonly title: string;
    readonly body: string;
    readonly bullets: readonly string[];
  };
  readonly flow: {
    readonly title: string;
    readonly steps: readonly FlowStepDto[];
    readonly body: string;
  };
  readonly trust: {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly items: readonly TrustItemDto[];
  };
  readonly benefits: {
    readonly title: string;
    readonly items: readonly TrustItemDto[];
  };
  readonly cta: {
    readonly title: string;
    readonly body: string;
    readonly ctas: readonly CtaDto[];
  };
};
