import { AutomationSection } from '@/features/site/components/sections/AutomationSection';
import { BenefitsSection } from '@/features/site/components/sections/BenefitsSection';
import { FlowSection } from '@/features/site/components/sections/FlowSection';
import { HeroSection } from '@/features/site/components/sections/HeroSection';
import { PlatformSection } from '@/features/site/components/sections/PlatformSection';
import { ProblemSection } from '@/features/site/components/sections/ProblemSection';
import { ProductSection } from '@/features/site/components/sections/ProductSection';
import { FaqSection } from '@/features/site/components/sections/FaqSection';

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <ProblemSection />
      <ProductSection />
      <PlatformSection />
      <AutomationSection />
      <FlowSection />
      <BenefitsSection />
      <FaqSection />
    </>
  );
}
