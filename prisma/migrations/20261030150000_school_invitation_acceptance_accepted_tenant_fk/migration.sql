DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public."PlatformSchoolInvitationConditionAcceptance" AS acceptance
    JOIN public."PlatformSchoolInvitation" AS invitation
      ON invitation."id" = acceptance."invitationId"
    WHERE invitation."acceptedContaId" IS DISTINCT FROM acceptance."contaId"
  ) THEN
    RAISE EXCEPTION 'Cannot enforce school invitation acceptance tenant binding: existing acceptance contaId differs from the invitation acceptedContaId.';
  END IF;
END
$$;

CREATE UNIQUE INDEX "uq_platform_school_invitation_id_accepted_conta"
  ON public."PlatformSchoolInvitation"("id", "acceptedContaId");

CREATE INDEX "PlatformSchoolInvitationConditionAcceptance_invitationId_contaId_idx"
  ON public."PlatformSchoolInvitationConditionAcceptance"("invitationId", "contaId");

ALTER TABLE public."PlatformSchoolInvitationConditionAcceptance"
  ADD CONSTRAINT "PlatformSchoolInvitationConditionAcceptance_invitationId_contaId_fkey"
  FOREIGN KEY ("invitationId", "contaId")
  REFERENCES public."PlatformSchoolInvitation"("id", "acceptedContaId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
