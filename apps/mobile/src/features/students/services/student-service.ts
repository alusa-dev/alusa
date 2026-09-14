import { authenticatedApi } from '@/features/auth/services/auth-service';
import type { StudentDetail, StudentListResponse, StudentNotifications } from '../types/student';

export const studentService = {
  listStudents() {
    return authenticatedApi.request<StudentListResponse>({
      method: 'GET',
      path: '/api/mobile/students',
    });
  },

  getStudent(studentId: string) {
    return authenticatedApi.request<{ student: StudentDetail }>({
      method: 'GET',
      path: `/api/mobile/students/${encodeURIComponent(studentId)}`,
    });
  },

  updateStudent(studentId: string, body: Record<string, unknown>) {
    return authenticatedApi.request<{ success: true }>({
      method: 'PATCH',
      path: `/api/mobile/students/${encodeURIComponent(studentId)}`,
      body,
    });
  },

  removeStudent(studentId: string, reason?: string) {
    return authenticatedApi.request<{ success: true; outcome: string }>({
      method: 'POST',
      path: `/api/mobile/students/${encodeURIComponent(studentId)}`,
      body: { action: 'DELETE', reason },
    });
  },

  reactivateStudent(studentId: string) {
    return authenticatedApi.request<{ success: true }>({
      method: 'POST',
      path: `/api/mobile/students/${encodeURIComponent(studentId)}`,
      body: { action: 'REACTIVATE' },
    });
  },

  getNotifications(studentId: string) {
    return authenticatedApi.request<StudentNotifications>({
      method: 'GET',
      path: `/api/mobile/students/${encodeURIComponent(studentId)}/notifications`,
    });
  },

  updateNotifications(studentId: string, preferences: StudentNotifications['preferences']) {
    return authenticatedApi.request<StudentNotifications>({
      method: 'PUT',
      path: `/api/mobile/students/${encodeURIComponent(studentId)}/notifications`,
      body: { preferences },
    });
  },
};
