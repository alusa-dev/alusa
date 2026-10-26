ALTER TABLE "FinanceProfile"
ADD CONSTRAINT "FinanceProfile_onboardingStudentCount_positive_check"
CHECK ("onboardingStudentCount" IS NULL OR "onboardingStudentCount" >= 1);
