import { AutomationSection } from '@/components/sections/AutomationSection';
import { BenefitsSection } from '@/components/sections/BenefitsSection';
import { FlowSection } from '@/components/sections/FlowSection';
import { HeroSection } from '@/components/sections/HeroSection';
import { PlatformSection } from '@/components/sections/PlatformSection';
import { ProblemSection } from '@/components/sections/ProblemSection';
import { ProductSection } from '@/components/sections/ProductSection';
import { FaqSection } from '@/components/sections/FaqSection';

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
