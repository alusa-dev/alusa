-- Legacy success/informational events were already persisted in the inbox
-- before the policy became allowlist-based. Hide them from the operational
-- inbox while preserving the Notification and AuditLog history.
UPDATE "NotificationRecipient" AS recipient
SET
  "archivedAt" = COALESCE(recipient."archivedAt", CURRENT_TIMESTAMP),
  "readAt" = COALESCE(recipient."readAt", CURRENT_TIMESTAMP)
FROM "Notification" AS notification
WHERE recipient."notificationId" = notification."id"
  AND notification."type" IN (
    'ENROLLMENT_CREATED',
    'ENROLLMENT_RENEWED',
    'ENROLLMENT_PAUSED',
    'ENROLLMENT_RESUMED',
    'BILLING_CREATED',
    'EXPERIMENTAL_SCHEDULED',
    'EXPERIMENTAL_RESCHEDULED',
    'EXPERIMENTAL_COMPLETED',
    'EXPERIMENTAL_CANCELLED'
  )
  AND (recipient."archivedAt" IS NULL OR recipient."readAt" IS NULL);
