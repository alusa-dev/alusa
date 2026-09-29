'use client';

import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/layout/DataTable';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { FinancialReportRankingItem } from '../dtos';
import { formatReportMoney } from '../utils/formatters';

export function OverviewRankingTable({
  byClass,
  byPlan,
  loading,
}: {
  byClass: FinancialReportRankingItem[];
  byPlan: FinancialReportRankingItem[];
  loading?: boolean;
}) {
  const [dimension, setDimension] = useState<'class' | 'plan'>('class');
  const data = dimension === 'class' ? byClass : byPlan;
  const columns: DataTableColumn<FinancialReportRankingItem>[] = [
    { id: 'name', header: dimension === 'class' ? 'Turma' : 'Plano', width: 'w-[30%]', noWrap: false, render: (row) => <span className="font-medium">{row.name}</span> },
    { id: 'students', header: 'Alunos', align: 'center', width: 'w-[12%]', render: (row) => row.studentCount },
    { id: 'charged', header: 'Em cobranças', align: 'right', width: 'w-[20%]', render: (row) => <span className="tabular-nums">{formatReportMoney(row.charged)}</span> },
    { id: 'received', header: 'Recebido', align: 'right', width: 'w-[20%]', render: (row) => <span className="tabular-nums">{formatReportMoney(row.received)}</span> },
    { id: 'overdue', header: 'Em atraso', align: 'right', width: 'w-[18%]', render: (row) => <span className="font-medium text-red-600 tabular-nums">{formatReportMoney(row.overdue)}</span> },
  ];
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs font-medium text-gray-500">Comparar por</span>
        <Tabs value={dimension} onValueChange={(value) => setDimension(value as 'class' | 'plan')}>
          <TabsList>
            <TabsTrigger value="class">Por turma</TabsTrigger>
            <TabsTrigger value="plan">Por plano</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <DataTable
        ariaLabel={`Ranking financeiro por ${dimension === 'class' ? 'turma' : 'plano'}`}
        data={data}
        columns={columns}
        rowKey={(row) => row.id}
        loading={loading}
        skeletonRows={5}
        emptyMessage={<div className="px-6 py-10 text-center text-sm text-gray-500">Sem dados acadêmicos para este período.</div>}
      />
    </section>
  );
}
