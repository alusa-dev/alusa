"use client";

import { Suspense } from "react";
import { ExtratoPage } from "@/features/financeiro/extrato";

export default function Page() {
  return (
    <Suspense>
      <ExtratoPage />
    </Suspense>
  );
}
