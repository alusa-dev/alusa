'use client';

import React from 'react';
import { cn } from '@/lib/utils';

import { PersonAvatar, type PersonAvatarSize } from './PersonAvatar';

export type AvatarGroupItem = {
  id: string;
  name: string;
  src?: string | null;
};

type AvatarGroupProps = {
  items: AvatarGroupItem[];
  max?: number;
  size?: PersonAvatarSize;
  className?: string;
  avatarClassName?: string;
  ringClassName?: string;
  fallbackClassName?: string;
};

const RING_BY_SIZE: Record<PersonAvatarSize, string> = {
  xs: 'outline-[2px]',
  sm: 'outline-[3px]',
  md: 'outline-[3px]',
  lg: 'outline-4',
  xl: 'outline-4',
};

export function AvatarGroup({
  items,
  max = 3,
  size = 'sm',
  className,
  avatarClassName,
  ringClassName = 'outline-[#e6d6fb] alusa-dark:outline-[color:var(--color-bg-card-soft)]',
  fallbackClassName,
}: AvatarGroupProps) {
  const visibleItems = items.slice(0, max);

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex items-center', className)}>
      {visibleItems.map((item, index) => (
        <PersonAvatar
          key={item.id}
          name={item.name}
          src={item.src}
          size={size}
          className={cn(
            RING_BY_SIZE[size],
            'outline outline-offset-0',
            ringClassName,
            index > 0 && '-ml-2',
            avatarClassName,
          )}
          fallbackClassName={fallbackClassName}
        />
      ))}
    </div>
  );
}
