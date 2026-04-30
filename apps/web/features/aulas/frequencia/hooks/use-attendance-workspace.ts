'use client';

import { startOfDay } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';

import { listAttendanceWorkspace } from '@/features/aulas/frequencia/services/attendance-service';

function getDefaultDate() {
  return startOfDay(new Date()).toISOString();
}

export function useAttendanceWorkspace(initialDate?: string) {
  const [selectedDate, setSelectedDate] = useState(initialDate ?? getDefaultDate());
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<Awaited<ReturnType<typeof listAttendanceWorkspace>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestKey = useMemo(
    () =>
      JSON.stringify({
        selectedDate,
        search: search.trim(),
        refreshKey,
      }),
    [refreshKey, search, selectedDate],
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await listAttendanceWorkspace({
          date: selectedDate,
          search: search.trim() || undefined,
        });
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [requestKey, search, selectedDate]);

  return {
    selectedDate,
    setSelectedDate,
    search,
    setSearch,
    data,
    loading,
    error,
    refresh: () => setRefreshKey((current) => current + 1),
  };
}
