import { useSessionStore } from '../stores/session-store';

export function useSession() {
  return useSessionStore();
}
