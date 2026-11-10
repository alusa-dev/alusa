ALTER TABLE "EventMapOrder"
  ADD COLUMN "metaMarketingConsentAt" TIMESTAMP(3),
  ADD COLUMN "metaMarketingConsentRevokedAt" TIMESTAMP(3),
  ADD COLUMN "metaMarketingConsentAnonymousId" VARCHAR(128),
  ADD COLUMN "metaMarketingConsentPolicyVersion" VARCHAR(32),
  ADD COLUMN "metaMarketingClientUserAgent" VARCHAR(512);
