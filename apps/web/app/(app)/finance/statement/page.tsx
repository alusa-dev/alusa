"use client";

import { Suspense } from "react";
import { StatementsPage } from "@/features/finance/operations/statements";

export default function Page() {
  return (
    <Suspense>
      <StatementsPage />
    </Suspense>
  );
}
