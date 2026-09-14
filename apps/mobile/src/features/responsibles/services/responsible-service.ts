import { authenticatedApi } from '@/features/auth/services/auth-service';
import type { ResponsibleDetailResponse, ResponsibleListResponse } from '../types/responsible';
import type { StudentNotificationPreference, StudentNotifications } from '@/features/students/types/student';

export const responsibleService = {
  listResponsibles(params: { query?: string; status?: 'ALL' | 'ACTIVE' | 'INACTIVE' } = {}) {
    const search = new URLSearchParams();
    if (params.query?.trim()) search.set('q', params.query.trim());
    if (params.status) search.set('status', params.status);
    return authenticatedApi.request<ResponsibleListResponse>({ method: 'GET', path: `/api/mobile/responsibles${search.size ? `?${search.toString()}` : ''}` });
  },

  getResponsible(responsibleId: string) {
    return authenticatedApi.request<ResponsibleDetailResponse>({ method: 'GET', path: `/api/mobile/responsibles/${encodeURIComponent(responsibleId)}` });
  },

  updateResponsible(responsibleId: string, body: Record<string, unknown>) {
    return authenticatedApi.request<{ success: true }>({ method: 'PATCH', path: `/api/mobile/responsibles/${encodeURIComponent(responsibleId)}`, body });
  },

  removeResponsible(responsibleId: string) {
    return authenticatedApi.request<{ success: true }>({ method: 'DELETE', path: `/api/mobile/responsibles/${encodeURIComponent(responsibleId)}` });
  },

  getNotifications(responsibleId: string) {
    return authenticatedApi.request<StudentNotifications>({ method: 'GET', path: `/api/mobile/responsibles/${encodeURIComponent(responsibleId)}/notifications` });
  },

  updateNotifications(responsibleId: string, preferences: StudentNotificationPreference[]) {
    return authenticatedApi.request<StudentNotifications>({ method: 'PUT', path: `/api/mobile/responsibles/${encodeURIComponent(responsibleId)}/notifications`, body: { preferences } });
  },
};
