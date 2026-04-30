'use client';

import { useEffect, useState } from 'react';

import type { ListAttendanceQueryDTO } from '@/features/aulas/dtos';
import { listAttendanceHistory } from '@/features/aulas/frequencia/services/attendance-service';

export type AttendanceFiltersState = {
  startDate?: string;
  endDate?: string;
  turmaId?: string;
  professorId?: string;
};

export function useAttendance(initial?: AttendanceFiltersState) {
  const [filters, setFilters] = useState<AttendanceFiltersState>(initial ?? {});
  const [data, setData] = useState<Awaited<ReturnType<typeof listAttendanceHistory>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await listAttendanceHistory(filters as Partial<ListAttendanceQueryDTO>);
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
  }, [requestKey, filters]);

  return {
    filters,
    setFilters,
    data,
    loading,
    error,
  };
}
