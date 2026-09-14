import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

type UseAppRefreshOptions = {
  intervalMs?: number | null;
};

export function useAppRefresh(refreshTask: () => Promise<void>, options: UseAppRefreshOptions = {}) {
  const intervalMs = options.intervalMs === undefined ? 15_000 : options.intervalMs;
  const taskRef = useRef(refreshTask);
  const runningRef = useRef(false);
  const previousStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    taskRef.current = refreshTask;
  }, [refreshTask]);

  const refresh = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRefreshing(true);
    try {
      await taskRef.current();
    } finally {
      runningRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const wasBackgrounded = previousStateRef.current !== 'active';
      previousStateRef.current = nextState;
      if (nextState === 'active' && wasBackgrounded) void refresh();
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    const interval = intervalMs === null ? null : setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, intervalMs);

    return () => {
      subscription.remove();
      if (interval) clearInterval(interval);
    };
  }, [intervalMs, refresh]);

  return { refreshing, refresh };
}
