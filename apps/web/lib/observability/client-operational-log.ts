'use client';

import * as Sentry from '@sentry/nextjs';

export type ClientOperationalEventName =
  | 'enrollment.detail.load_failed'
  | 'enrollment.list.load_failed'
  | 'enrollment.list.delete_failed'
  | 'enrollment.taxa_links.load_failed'
  | 'enrollment.create.failed'
  | 'enrollment.family_create.failed'
  | 'enrollment.resend_charge.request_failed'
  | 'student.wizard.step_create.failed'
  | 'student.deactivate.failed'
  | 'student.reactivate.failed'
  | 'student.update.failed'
  | 'employee.detail.load_failed'
  | 'employee.update.failed'
  | 'charge.detail.sync_failed'
  | 'finance.charge.notification_defaults.load_failed'
  | 'finance.charge.files.load_failed'
  | 'finance.charge.files.upload_failed'
  | 'finance.charge.files.delete_failed'
  | 'finance.account.initial_load.failed'
  | 'finance.account.refresh.failed'
  | 'account.subscriptions.sync_failed'
  | 'dashboard.enrollment_fee.load_failed'
  | 'notifications.context.open_failed'
  | 'teacher.lookup.failed'
  | 'portal.notifications.load_failed'
  | 'dashboard.welcome_wizard.load_failed'
  | 'admin.users.students.load_failed'
  | 'notifications.feed.unread_count.failed'
  | 'notifications.feed.load_failed'
  | 'notifications.feed.update_failed'
  | 'notifications.feed.mark_all_read.failed'
  | 'notifications.feed.delete_failed'
  | 'contracts.preview.load_failed'
  | 'contracts.details.load_failed'
  | 'contracts.template.details.load_failed'
  | 'contracts.templates.load_failed'
  | 'platform_billing.summary.load_failed'
  | 'public_event_map.order_poll.failed'
  | 'public_event.participant.student_lookup.failed'
  | 'portal.student_selector.load_failed'
  | 'auth.login.sign_in.failed'
  | 'auth.password_reset.request_failed'
  | 'auth.registration.server_failed'
  | 'auth.registration.unexpected_failed'
  | 'auth.registration.auto_login.failed';

type SafeErrorType =
  | 'Error'
  | 'TypeError'
  | 'RangeError'
  | 'AbortError'
  | 'ZodError'
  | 'PrismaClientKnownRequestError'
  | 'PrismaClientValidationError'
  | 'ApiError'
  | 'EnrollmentError'
  | 'StudentError'
  | 'AvatarServiceError'
  | 'HttpError';

const SAFE_ERROR_TYPES = new Set<SafeErrorType>([
  'Error', 'TypeError', 'RangeError', 'AbortError', 'ZodError',
  'PrismaClientKnownRequestError', 'PrismaClientValidationError', 'ApiError',
  'EnrollmentError', 'StudentError', 'AvatarServiceError', 'HttpError',
]);
const lastCapturedAt = new Map<ClientOperationalEventName, number>();
const COOLDOWN_MS = 60_000;

function safeErrorType(error: unknown): SafeErrorType | undefined {
  if (!(error instanceof Error)) return undefined;
  return SAFE_ERROR_TYPES.has(error.name as SafeErrorType) ? error.name as SafeErrorType : 'Error';
}

export function logClientOperationalEvent(
  eventName: ClientOperationalEventName,
  error?: unknown,
): void {
  const now = Date.now();
  const previous = lastCapturedAt.get(eventName);
  if (previous !== undefined && now - previous < COOLDOWN_MS) return;
  lastCapturedAt.set(eventName, now);

  const errorType = safeErrorType(error);
  Sentry.captureMessage(eventName, {
    level: 'error',
    tags: {
      event_name: eventName,
      ...(errorType ? { error_type: errorType } : {}),
    },
  });
}
