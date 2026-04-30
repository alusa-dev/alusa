'use client';

export function MatriculaHeader() {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex-1">
        <h1 className="text-3xl font-bold text-gray-900 leading-tight mb-2">
          Detalhes da matrícula
        </h1>
        <p className="text-base text-gray-600">
          Gerencie e visualize todas as informações, cobranças e configurações desta matrícula
        </p>
      </div>
    </div>
  );
}
