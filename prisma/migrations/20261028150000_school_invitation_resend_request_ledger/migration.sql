CREATE TABLE "PlatformSchoolInvitationResendRequest" (
  "invitationId" TEXT NOT NULL,
  "requestKeyFingerprint" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformSchoolInvitationResendRequest_pkey"
    PRIMARY KEY ("invitationId", "requestKeyFingerprint"),
  CONSTRAINT "PlatformSchoolInvitationResendRequest_invitationId_fkey"
    FOREIGN KEY ("invitationId") REFERENCES "PlatformSchoolInvitation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "PlatformSchoolInvitationResendRequest_invitationId_createdAt_idx"
  ON "PlatformSchoolInvitationResendRequest"("invitationId", "createdAt");
