import { authenticatedApi } from '@/features/auth/services/auth-service';
import type {
  EnrollmentClassDetailResponse,
  EnrollmentClassListResponse,
  EnrollmentDetail,
  EnrollmentUpdateInput,
} from '../types/enrollment';

export const enrollmentService = {
  listClasses() {
    return authenticatedApi.request<EnrollmentClassListResponse>({
      method: 'GET',
      path: '/api/mobile/enrollments',
    });
  },

  getClass(classId: string) {
    return authenticatedApi.request<EnrollmentClassDetailResponse>({
      method: 'GET',
      path: `/api/mobile/enrollments/${encodeURIComponent(classId)}`,
    });
  },

  getEnrollment(enrollmentId: string) {
    return authenticatedApi.request<{ enrollment: EnrollmentDetail }>({
      method: 'GET',
      path: `/api/mobile/enrollment-details/${encodeURIComponent(enrollmentId)}`,
    });
  },

  updateEnrollment(enrollmentId: string, body: EnrollmentUpdateInput) {
    return authenticatedApi.request<{ success: true }>({
      method: 'PATCH',
      path: `/api/mobile/enrollment-details/${encodeURIComponent(enrollmentId)}`,
      body,
    });
  },

  executeAction(enrollmentId: string, body: { action: 'PAUSE' | 'REACTIVATE' | 'CANCEL'; reason?: string; startDate?: string; returnDate?: string; nextDueDate?: string }) {
    return authenticatedApi.request<{ success: true }>({
      method: 'POST',
      path: `/api/mobile/enrollment-details/${encodeURIComponent(enrollmentId)}`,
      body,
    });
  },

  deleteEnrollment(enrollmentId: string) {
    return authenticatedApi.request<{ success: true }>({
      method: 'DELETE',
      path: `/api/mobile/enrollment-details/${encodeURIComponent(enrollmentId)}`,
    });
  },
};
