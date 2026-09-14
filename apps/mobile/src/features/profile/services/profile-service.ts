import { authenticatedApi } from '@/features/auth/services/auth-service';
import type { MobileProfile, MobileProfileUpdateInput } from '../types/profile';

export const profileService = {
  getProfile() {
    return authenticatedApi.request<MobileProfile>({
      method: 'GET',
      path: '/api/mobile/profile',
    });
  },
  updateProfile(input: MobileProfileUpdateInput) {
    return authenticatedApi.request<MobileProfile, MobileProfileUpdateInput>({
      method: 'PATCH',
      path: '/api/mobile/profile',
      body: input,
    });
  },
};
