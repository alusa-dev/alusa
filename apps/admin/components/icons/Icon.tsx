import {
  ArrowPathIcon,
  Bars3Icon,
  BellIcon,
  BuildingLibraryIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ClockIcon,
  Cog6ToothIcon,
  CreditCardIcon,
  DocumentTextIcon,
  EyeIcon,
  HomeIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  UsersIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, HTMLAttributes, SVGProps } from 'react';

export type IconName =
  | 'Search'
  | 'Home'
  | 'InformationCircle'
  | 'ExclamationTriangle'
  | 'WrenchScrewdriver'
  | 'BuildingLibrary'
  | 'CreditCard'
  | 'ArrowPath'
  | 'DocumentText'
  | 'Eye'
  | 'Clock'
  | 'Cog6Tooth'
  | 'Users'
  | 'Bell'
  | 'CheckCircle'
  | 'ChevronRight'
  | 'ChevronDown'
  | 'Bars3'
  | 'XMark';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const icons: Record<IconName, IconComponent> = {
  Search: MagnifyingGlassIcon,
  Home: HomeIcon,
  InformationCircle: InformationCircleIcon,
  ExclamationTriangle: ExclamationTriangleIcon,
  WrenchScrewdriver: WrenchScrewdriverIcon,
  BuildingLibrary: BuildingLibraryIcon,
  CreditCard: CreditCardIcon,
  ArrowPath: ArrowPathIcon,
  DocumentText: DocumentTextIcon,
  Eye: EyeIcon,
  Clock: ClockIcon,
  Cog6Tooth: Cog6ToothIcon,
  Users: UsersIcon,
  Bell: BellIcon,
  CheckCircle: CheckCircleIcon,
  ChevronRight: ChevronRightIcon,
  ChevronDown: ChevronDownIcon,
  Bars3: Bars3Icon,
  XMark: XMarkIcon,
};

export function Icon({ name, size = 16, ...props }: HTMLAttributes<HTMLSpanElement> & { name: IconName; size?: number }) {
  const IconComponent = icons[name];
  const label = props['aria-label'] ?? name;
  return (
    <span role="img" aria-label={label} style={{ display: 'inline-flex', width: size, height: size, alignItems: 'center', justifyContent: 'center' }} {...props}>
      <IconComponent aria-hidden="true" focusable="false" width={size} height={size} />
    </span>
  );
}
