"use client";

import Image from "next/image";
import { IntegrationCard } from "./components/IntegrationCard";

export function IntegracoesFeature() {
  return (
    <section className="space-y-4">
      <IntegrationCard
        title="Plataforma de pagamento Asaas"
        description=""
        icon={
          <Image
            src="/asaas/asaas-icon.png"
            alt="Asaas"
            width={48}
            height={48}
            className="h-12 w-12 object-cover"
            priority
          />
        }
        status={{ label: "Gerenciado pela Alusa" }}
      />
      {/* Espaço reservado para futuras integrações */}
    </section>
  );
}

export default IntegracoesFeature;
