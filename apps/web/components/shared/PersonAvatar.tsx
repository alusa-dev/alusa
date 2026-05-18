'use client';

import React from 'react';
import { formatInitials } from '@alusa/lib/client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

const SIZE_CLASSES = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-xs',
  lg: 'h-11 w-11 text-sm',
  xl: 'h-16 w-16 text-xl',
} as const;

export type PersonAvatarSize = keyof typeof SIZE_CLASSES;

type PersonAvatarProps = {
  name: string;
  src?: string | null;
  size?: PersonAvatarSize;
  className?: string;
  fallbackClassName?: string;
  imageClassName?: string;
};

export function PersonAvatar({
  name,
  src,
  size = 'md',
  className,
  fallbackClassName,
  imageClassName,
}: PersonAvatarProps) {
  const avatarUrl = src?.trim() || undefined;
  const initials = formatInitials(name || '');

  return (
    <Avatar className={cn(SIZE_CLASSES[size], 'shrink-0', className)}>
      {avatarUrl ? (
        <AvatarImage
          src={avatarUrl}
          alt={name}
          className={cn('object-cover', imageClassName)}
        />
      ) : null}
      <AvatarFallback
        className={cn(
          'bg-purple-100 font-semibold text-purple-700 alusa-dark:bg-[color:rgba(169,77,255,0.16)] alusa-dark:text-[color:#c9a7ff]',
          fallbackClassName,
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
