-- Preserve accepted school invitation audit state when its tenant is referenced.
ALTER TABLE public."PlatformSchoolInvitation"
  DROP CONSTRAINT IF EXISTS "PlatformSchoolInvitation_acceptedContaId_fkey";

ALTER TABLE public."PlatformSchoolInvitation"
  ADD CONSTRAINT "PlatformSchoolInvitation_acceptedContaId_fkey"
  FOREIGN KEY ("acceptedContaId") REFERENCES public."Conta"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
