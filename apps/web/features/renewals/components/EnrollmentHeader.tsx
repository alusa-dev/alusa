'use client';

export function EnrollmentHeader({ matriculaId }: { matriculaId: string }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex-1">
        <h1 className="text-3xl font-bold text-gray-900 leading-tight mb-2">
          Detalhes da matrícula
        </h1>
        <p className="text-sm text-gray-600">
          ID: <span className="font-mono text-xs uppercase text-gray-500">{matriculaId}</span>
        </p>
      </div>
    </div>
  );
}
