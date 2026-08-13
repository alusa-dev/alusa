CREATE TABLE "NotificationDigestEvent" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDigestEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_notification_digest_event_conta_event"
  ON "NotificationDigestEvent"("contaId", "eventKey");
CREATE INDEX "idx_notification_digest_event_conta_notification"
  ON "NotificationDigestEvent"("contaId", "notificationId");

ALTER TABLE "NotificationDigestEvent"
  ADD CONSTRAINT "NotificationDigestEvent_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDigestEvent"
  ADD CONSTRAINT "NotificationDigestEvent_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
