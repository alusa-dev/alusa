'use client';

import { useRouter } from 'next/navigation';

import { useLiveRefresh } from '@/hooks/useLiveRefresh';

export function GlobalAdminLiveRefresh({
  intervalMs = 60_000,
  enabled = true,
}: {
  intervalMs?: number | null;
  enabled?: boolean;
}) {
  const router = useRouter();

  useLiveRefresh(
    () => {
      router.refresh();
    },
    {
      enabled,
      intervalMs,
      minIntervalMs: 10_000,
    },
  );

  return null;
}
