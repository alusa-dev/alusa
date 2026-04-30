import { globalAdminSessionDTOSchema } from './dtos';
import type { GlobalAdminSession } from './session.server';

export function mapGlobalAdminSessionToDTO(session: GlobalAdminSession) {
  return globalAdminSessionDTOSchema.parse(session);
}
