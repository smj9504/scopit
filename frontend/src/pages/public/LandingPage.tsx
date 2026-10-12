/**
 * Scopit - Landing Page
 * A toolkit of work tools for restoration contractors; estimates and invoices
 * are the home base every tool feeds. Sections live in ./landing.
 */
import React, { useRef } from 'react';
import { usePageSEO } from '@/hooks/usePageSEO';
import LandingHeader from './landing/LandingHeader';
import HeroSection from './landing/HeroSection';
import JobTypeMatrix from './landing/JobTypeMatrix';
import ToolSections from './landing/ToolSections';
import EstimatesSection from './landing/EstimatesSection';
import { ProofSection, PricingSection, FaqSection, FinalCta, LandingFooter } from './landing/ClosingSections';
import { useLandingMotion } from './landing/useLandingMotion';
import './landing/landing.css';

const LandingPage: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);

  usePageSEO({
    title: 'Scopit - Work Tools for Restoration Contractors',
    description:
      'Price pack-outs, read roof reports, find line items and get documents signed. Every tool feeds your estimates and invoices. Free beta through 2026.',
    path: '/',
  });

  useLandingMotion(rootRef);

  return (
    <div id="top" className="lp" ref={rootRef}>
      <LandingHeader />
      <main>
        <HeroSection />
        <JobTypeMatrix />
        <ToolSections />
        <EstimatesSection />
        <ProofSection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
};

export default LandingPage;
