'use client';

import * as React from 'react';
import { DASHBOARD_SECTION_CARD_CLASSNAME } from '@/app/(app)/dashboard/components/utils';
import { Warning } from '@/components/icons/icons';
import type { FinancialReportDataQuality } from '../dtos';

export function ReportsDataQualityNotice({
  dataQuality,
}: {
  dataQuality?: FinancialReportDataQuality;
}) {
  if (!dataQuality?.warnings.length) return null;

  return (
    <aside
      role="status"
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} flex items-start gap-3 rounded-2xl bg-amber-50/70 p-4 alusa-dark:bg-amber-950/20`}
    >
      <Warning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
      <div>
        <h2 className="text-sm font-semibold text-amber-900 alusa-dark:text-amber-200">
          Atenção à qualidade dos dados
        </h2>
        <ul className="mt-1 space-y-1 text-xs text-amber-800 alusa-dark:text-amber-300">
          {dataQuality.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
