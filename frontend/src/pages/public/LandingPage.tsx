import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageSEO } from '@/hooks/usePageSEO';

// Scopit Landing Page
// Save as: frontend/src/pages/public/LandingPage.tsx

function useInView<T extends HTMLElement>(options?: IntersectionObserverInit) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin: '-100px', ...options });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, inView };
}

function useCountUp(target: number, start: boolean, duration = 600) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!start) return;
    let raf: number;
    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, target, duration]);

  return value;
}

const formatCurrency = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  usePageSEO({
    title: 'Scopit - Estimating Software for Restoration Contractors',
    description:
      'Create professional restoration estimates in minutes, not hours. Simple estimating and invoicing software built for restoration contractors. Join the free beta.',
    path: '/',
  });

  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [scrolled, setScrolled] = useState(false);

  const packingReveal = useInView<HTMLDivElement>();
  const problemReveal = useInView<HTMLDivElement>();
  const featuresReveal = useInView<HTMLDivElement>();
  const howItWorksReveal = useInView<HTMLDivElement>();
  const betaReveal = useInView<HTMLDivElement>();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Hero mockup "assembles itself" — rows land first, then totals tally up,
  // echoing the product's own promise (an estimate finished in seconds).
  const [mockupAssembled, setMockupAssembled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMockupAssembled(true), 1650);
    return () => clearTimeout(t);
  }, []);

  const subtotalValue = useCountUp(1325, mockupAssembled, 650);
  const taxValue = useCountUp(112.63, mockupAssembled, 650);
  const totalValue = useCountUp(1437.63, mockupAssembled, 750);

  const handleJoinBeta = () => {
    navigate('/register');
  };

  const handleLogin = () => {
    navigate('/login');
  };

  const handleTryPackingDemo = () => {
    navigate('/demo/packing');
  };

  const handleGetRealPackingEstimate = () => {
    navigate('/packing-estimate');
  };

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const packingSteps = [
    { num: '01', title: 'Upload photos', desc: 'Snap or upload photos of any room.' },
    { num: '02', title: 'AI detects contents', desc: 'Sofa, TV, bookshelf — tagged automatically with confidence scores.' },
    { num: '03', title: 'Edit if needed', desc: 'Adjust quantities, categories, or fragility in seconds.' },
    { num: '04', title: 'Get a priced estimate', desc: 'Labor, materials, and packing costs calculated instantly.' },
  ];

  const features = [
    { 
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
      ),
      title: 'Estimates', 
      desc: 'Create professional estimates with your custom line items in minutes, not hours.' 
    },
    { 
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="1" x2="12" y2="23"></line>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
        </svg>
      ),
      title: 'Invoices', 
      desc: 'Convert estimates to invoices with one click. Track payment status easily.' 
    },
    { 
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
      ),
      title: 'Customers', 
      desc: 'Keep all customer information organized in one central place.' 
    },
    { 
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="6" x2="21" y2="6"></line>
          <line x1="8" y1="12" x2="21" y2="12"></line>
          <line x1="8" y1="18" x2="21" y2="18"></line>
          <line x1="3" y1="6" x2="3.01" y2="6"></line>
          <line x1="3" y1="12" x2="3.01" y2="12"></line>
          <line x1="3" y1="18" x2="3.01" y2="18"></line>
        </svg>
      ),
      title: 'Line Items', 
      desc: 'Build your reusable library of services and materials for faster estimates.' 
    },
    { 
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      ),
      title: 'PDF Export', 
      desc: 'Generate professional branded PDFs instantly. Email directly to clients.' 
    },
    { 
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
          <line x1="12" y1="18" x2="12.01" y2="18"></line>
        </svg>
      ),
      title: 'Mobile Ready', 
      desc: 'Create and send estimates on the job site from any device.' 
    },
  ];

  const steps = [
    { num: '01', title: 'Set up your account', desc: 'Add your business info and build your line item library. Takes about 5 minutes.' },
    { num: '02', title: 'Create estimates', desc: 'Select a customer, add line items, and generate a professional PDF estimate.' },
    { num: '03', title: 'Send and get paid', desc: 'Email estimates directly to clients. Convert to invoices when approved.' },
  ];

  const faqs = [
    { q: 'Is the beta really free?', a: 'Yes. During the beta period, all features are completely free. We want your feedback to make Scopit better.' },
    { q: 'How long will the beta last?', a: 'We expect the beta to run for 2-3 months. Beta users will get special pricing when we launch.' },
    { q: 'Will I lose my data after beta?', a: 'No. All your estimates, invoices, and customer data will be preserved when we move to full launch.' },
    { q: 'What kind of feedback are you looking for?', a: 'Anything that helps us improve: bugs, feature requests, workflow suggestions, or things that feel awkward.' },
    { q: 'Is my data secure?', a: 'Yes. We use industry-standard encryption and secure cloud hosting. Your data is backed up daily.' },
  ];

  return (
    <div style={{ 
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      color: '#1f2937',
      lineHeight: 1.6,
      overflowX: 'hidden',
    }}>
      
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600&display=swap');
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        
        .headline { font-family: 'Plus Jakarta Sans', sans-serif; }
        
        .btn-primary {
          background: #111827;
          color: white;
          border: none;
          padding: 14px 28px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 16px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .btn-primary:hover {
          background: #374151;
        }
        
        .btn-secondary {
          background: transparent;
          color: #374151;
          border: 1px solid #d1d5db;
          padding: 14px 28px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 16px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .btn-secondary:hover {
          border-color: #111827;
          color: #111827;
        }
        
        .feature-card {
          padding: 32px;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          transition: all 0.2s ease;
        }
        
        .feature-card:hover {
          border-color: #111827;
        }
        
        .faq-item {
          border-bottom: 1px solid #e5e7eb;
          padding: 24px 0;
          cursor: pointer;
        }

        .faq-item:last-child { border-bottom: none; }

        .faq-answer {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }

        .faq-answer-inner {
          overflow: hidden;
        }

        .faq-answer-inner p {
          margin: 0;
          padding-top: 16px;
          color: #6b7280;
          line-height: 1.7;
          font-size: 15px;
          opacity: 0;
          transition: opacity 180ms ease-out;
        }

        @keyframes materialize {
          from { opacity: 0; transform: scale(0.96) translateY(14px); filter: blur(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
        }

        @keyframes materializeLg {
          from { opacity: 0; transform: scale(0.92) translateY(28px); filter: blur(10px); box-shadow: 0 0 0 rgba(17, 24, 39, 0); }
          to { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); box-shadow: 0 25px 50px -12px rgba(17, 24, 39, 0.18), 0 10px 20px -8px rgba(17, 24, 39, 0.1); }
        }

        @keyframes rowReveal {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }

        @keyframes drawLine {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }

        @keyframes glowIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .hero-stagger {
          animation: materialize 550ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .hero-stagger-lg {
          animation: materializeLg 650ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .reveal {
          opacity: 0;
        }

        .reveal-visible {
          animation: materialize 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .beta-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #111827;
          margin-right: 8px;
          animation: livePulse 2.2s ease-in-out infinite;
        }

        .app-preview {
          position: relative;
        }

        .app-preview::before {
          content: '';
          position: absolute;
          inset: -60px;
          background: radial-gradient(closest-side, rgba(17, 24, 39, 0.08), transparent 70%);
          opacity: 0;
          animation: glowIn 900ms ease-out 450ms both;
          pointer-events: none;
        }

        .row-reveal {
          animation: rowReveal 350ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .summary-divider {
          transform-origin: left;
          animation: drawLine 250ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .process-rail {
          position: relative;
        }

        .process-rail::before {
          content: '';
          position: absolute;
          top: 27px;
          left: 0;
          right: 0;
          height: 1px;
          background: #e5e7eb;
        }

        .process-rail-fill {
          position: absolute;
          top: 27px;
          left: 0;
          height: 1px;
          width: 100%;
          background: #111827;
          transform-origin: left;
          transform: scaleX(0);
        }

        .reveal-visible .process-rail-fill {
          animation: drawLine 900ms cubic-bezier(0.16, 1, 0.3, 1) 200ms both;
        }

        .process-step {
          position: relative;
          opacity: 0;
        }

        .reveal-visible .process-step {
          animation: rowReveal 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .reveal-visible .process-step:nth-child(1) { animation-delay: 120ms; }
        .reveal-visible .process-step:nth-child(2) { animation-delay: 320ms; }
        .reveal-visible .process-step:nth-child(3) { animation-delay: 520ms; }
        .reveal-visible .process-step:nth-child(4) { animation-delay: 720ms; }

        .process-node {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-weight: 700;
          font-size: 18px;
          color: #9ca3af;
          position: relative;
          z-index: 1;
          transition: all 0.25s ease;
        }

        .process-step--hero .process-node {
          background: #111827;
          border-color: #111827;
          color: #ffffff;
          width: 64px;
          height: 64px;
          font-size: 20px;
          box-shadow: 0 12px 24px -8px rgba(17, 24, 39, 0.35);
        }

        .process-step--hero {
          margin-top: -4px;
        }

        @media (max-width: 768px) {
          .process-rail::before,
          .process-rail-fill {
            top: 0;
            left: 27px;
            right: auto;
            bottom: 0;
            width: 1px;
            height: 100%;
          }
          .process-rail-fill {
            transform: scaleY(0);
            transform-origin: top;
          }
          .reveal-visible .process-rail-fill {
            animation-name: drawLineVertical;
          }
          .process-step {
            flex-direction: row !important;
            align-items: flex-start !important;
          }
          .process-step + .process-step {
            margin-top: 28px;
          }
          .process-step--hero {
            margin-top: 0;
          }
          .process-step--hero + .process-step {
            margin-top: 32px;
          }
        }

        @keyframes drawLineVertical {
          from { transform: scaleY(0); }
          to { transform: scaleY(1); }
        }

        .site-header {
          transition: box-shadow 200ms ease-out, background-color 200ms ease-out;
          backdrop-filter: blur(12px) saturate(180%);
          -webkit-backdrop-filter: blur(12px) saturate(180%);
        }

        .site-header.scrolled {
          box-shadow: 0 1px 3px rgba(17, 24, 39, 0.08), 0 8px 24px -12px rgba(17, 24, 39, 0.12);
        }

        @media (prefers-reduced-transparency: reduce) {
          .site-header { background: rgba(255, 255, 255, 0.98) !important; backdrop-filter: none; -webkit-backdrop-filter: none; }
        }

        .section { padding: 100px 20px; }
        .container { max-width: 1100px; margin: 0 auto; }
        
        input[type="email"] {
          padding: 14px 16px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 16px;
          width: 100%;
          max-width: 300px;
        }
        
        input[type="email"]:focus {
          outline: none;
          border-color: #111827;
        }
        
        /* Tablet */
        @media (max-width: 1024px) {
          .app-preview { display: none !important; }
        }

        /* Mobile */
        @media (max-width: 768px) {
          .section { padding: 60px 16px; }
          .desktop-only { display: none !important; }
          .steps-grid { grid-template-columns: 1fr !important; gap: 32px !important; }
          .features-grid { grid-template-columns: 1fr !important; }
          .packing-grid { grid-template-columns: 1fr !important; }
          .comparison-grid { grid-template-columns: 1fr !important; }
          .hero-section { padding-top: 100px !important; padding-bottom: 60px !important; }
          .hero-title { font-size: 2rem !important; }
          .hero-subtitle { font-size: 1rem !important; }
          .hero-buttons { flex-direction: column !important; width: 100%; }
          .hero-buttons button { width: 100% !important; }
          .section-title { font-size: 24px !important; }
          .beta-card { padding: 24px !important; }
          .footer-content { flex-direction: column !important; align-items: flex-start !important; }
          .footer-links { flex-direction: column !important; gap: 24px !important; width: 100%; }
          .faq-question { font-size: 15px !important; }
          .cta-section { padding: 60px 16px !important; }
          .cta-title { font-size: 22px !important; }
          .feature-card { padding: 24px !important; }
          .problem-section { padding: 60px 16px !important; }
          .how-it-works-section { padding: 60px 16px !important; }
          .beta-section { padding: 60px 16px !important; }
          .faq-section { padding: 60px 16px !important; }
        }

        /* Small phones */
        @media (max-width: 480px) {
          .hero-title { font-size: 1.75rem !important; }
          .section-title { font-size: 22px !important; }
          .steps-grid { gap: 24px !important; }
          .step-number { font-size: 36px !important; }
          .step-title { font-size: 18px !important; }
        }

        @media (min-width: 769px) {
          .mobile-only { display: none !important; }
        }
      `}</style>

      {/* Header */}
      <header className={`site-header${scrolled ? ' scrolled' : ''}`} style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        background: 'rgba(255,255,255,0.72)',
        zIndex: 1000,
        borderBottom: '1px solid #e5e7eb',
      }}>
        <div className="container" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
        }}>
          <a href="/" style={{ textDecoration: 'none' }}>
            <span className="headline" style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>
              Scopit
            </span>
          </a>
          
          <nav style={{ display: 'flex', alignItems: 'center', gap: '32px' }} className="desktop-only">
            <a onClick={() => scrollToSection('features')} style={{ color: '#6b7280', textDecoration: 'none', fontWeight: 500, fontSize: 15, cursor: 'pointer' }}>Features</a>
            <a onClick={() => scrollToSection('how-it-works')} style={{ color: '#6b7280', textDecoration: 'none', fontWeight: 500, fontSize: 15, cursor: 'pointer' }}>How it works</a>
            <a onClick={() => scrollToSection('faq')} style={{ color: '#6b7280', textDecoration: 'none', fontWeight: 500, fontSize: 15, cursor: 'pointer' }}>FAQ</a>
            <a onClick={handleLogin} style={{ color: '#6b7280', textDecoration: 'none', fontWeight: 500, fontSize: 15, cursor: 'pointer' }}>Log in</a>
            <button className="btn-primary" style={{ padding: '10px 20px', fontSize: 14 }} onClick={handleJoinBeta}>
              Join Beta
            </button>
          </nav>

          <button className="btn-primary mobile-only" style={{ padding: '10px 20px', fontSize: 14 }} onClick={handleJoinBeta}>
            Join Beta
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-section" style={{
        paddingTop: 140,
        paddingBottom: 80,
        background: '#ffffff',
      }}>
        <div className="container" style={{ textAlign: 'center', padding: '0 16px' }}>
          <div className="hero-stagger" style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: '#f3f4f6',
            color: '#374151',
            padding: '6px 14px',
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 24,
            letterSpacing: '0.5px',
          }}>
            <span className="beta-dot" aria-hidden="true"></span>
            NOW IN BETA — FREE ACCESS
          </div>

          <h1 className="headline hero-title hero-stagger" style={{
            fontSize: 'clamp(2.5rem, 6vw, 4rem)',
            fontWeight: 800,
            color: '#111827',
            lineHeight: 1.1,
            marginBottom: 24,
            letterSpacing: '-0.03em',
            animationDelay: '60ms',
          }}>
            Professional estimates<br />
            in minutes, not hours
          </h1>

          <p className="hero-subtitle hero-stagger" style={{
            fontSize: 'clamp(1.1rem, 2vw, 1.25rem)',
            color: '#6b7280',
            maxWidth: 540,
            margin: '0 auto 40px',
            padding: '0 16px',
            animationDelay: '120ms',
          }}>
            Simple estimating software for restoration contractors.
            Stop wasting time in Excel. Start looking professional.
          </p>

          <div className="hero-buttons hero-stagger" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', padding: '0 16px', animationDelay: '180ms' }}>
            <button className="btn-primary" style={{ fontSize: 16, padding: '16px 32px' }} onClick={handleJoinBeta}>
              Join Free Beta
            </button>
            <button className="btn-secondary" style={{ fontSize: 16, padding: '16px 32px' }} onClick={() => scrollToSection('how-it-works')}>
              See how it works
            </button>
          </div>

          <p className="hero-stagger" style={{
            marginTop: 24,
            fontSize: 14,
            color: '#9ca3af',
            animationDelay: '220ms',
          }}>
            No credit card required. All features included.
          </p>

          {/* App Preview */}
          <div className="app-preview hero-stagger-lg" style={{
            marginTop: 80,
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: 24,
            maxWidth: 1000,
            margin: '80px auto 0',
            animationDelay: '280ms',
          }}>
            {/* Mockup Browser Frame */}
            <div style={{
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              overflow: 'hidden',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
            }}>
              {/* Browser Header */}
              <div style={{
                background: '#f3f4f6',
                borderBottom: '1px solid #e5e7eb',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444' }}></div>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#f59e0b' }}></div>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981' }}></div>
                </div>
                <div style={{
                  flex: 1,
                  background: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 13,
                  color: '#6b7280',
                  textAlign: 'center',
                  margin: '0 40px',
                }}>
                  app.scopit.com/estimates/123
                </div>
              </div>

              {/* Mockup Content */}
              <div style={{
                background: '#f9fafb',
                padding: 24,
                minHeight: 500,
              }}>
                {/* Header */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 16,
                  marginBottom: 24,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <h2 style={{
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        fontSize: 20,
                        fontWeight: 700,
                        color: '#111827',
                        margin: 0,
                        letterSpacing: '-0.01em',
                        textAlign: 'left',
                      }}>
                        EST-1004
                      </h2>
                      <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 10px',
                        background: '#ede9fe',
                        color: '#7c3aed',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 500,
                      }}>
                        Viewed
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: '#6b7280', textAlign: 'left' }}>
                      Water Damage Restoration — Johnson Residence
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['Download PDF', 'Send'].map((label) => (
                      <span key={label} style={{
                        padding: '6px 12px',
                        border: '1px solid #e5e7eb',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 500,
                        color: '#374151',
                        background: '#ffffff',
                      }}>
                        {label}
                      </span>
                    ))}
                    <span style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#ffffff',
                      background: '#111827',
                    }}>
                      Record Payment
                    </span>
                    <span style={{
                      padding: '6px 12px',
                      border: '1px solid #e5e7eb',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#374151',
                      background: '#ffffff',
                    }}>
                      Edit
                    </span>
                    <span style={{
                      padding: '6px 10px',
                      border: '1px solid #e5e7eb',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#374151',
                      background: '#ffffff',
                    }}>
                      ···
                    </span>
                  </div>
                </div>

                {/* Main Content */}
                <div style={{
                  display: 'flex',
                  gap: 24,
                  flexWrap: 'wrap',
                }}>
                  {/* Left Column */}
                  <div style={{ flex: 1, minWidth: 400 }}>
                    {/* Customer Card */}
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 12,
                      padding: 20,
                      marginBottom: 16,
                    }}>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: 20,
                      }}>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 8, fontWeight: 500, textAlign: 'left' }}>Customer</div>
                          <div style={{ fontWeight: 600, color: '#111827', marginBottom: 4, textAlign: 'left' }}>Johnson Residence</div>
                          <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'left' }}>michael.johnson@email.com</div>
                          <div style={{ color: '#6b7280', fontSize: 13, textAlign: 'left' }}>1234 Oak Street, Springfield, IL 62701</div>
                        </div>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 8, fontWeight: 500, textAlign: 'left' }}>Estimate Date</div>
                          <div style={{ color: '#111827', textAlign: 'left' }}>February 2, 2026</div>
                        </div>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 8, fontWeight: 500, textAlign: 'left' }}>Valid Until</div>
                          <div style={{ color: '#111827', textAlign: 'left' }}>March 4, 2026</div>
                        </div>
                      </div>
                    </div>

                    {/* Line Items Card */}
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 12,
                      padding: 20,
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 16,
                      }}>
                        <h3 style={{
                          fontFamily: "'Plus Jakarta Sans', sans-serif",
                          fontSize: 15,
                          fontWeight: 600,
                          color: '#111827',
                          margin: 0,
                          textAlign: 'left',
                        }}>
                          General
                        </h3>
                        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 14, color: '#111827', letterSpacing: '-0.01em' }}>
                          {formatCurrency(subtotalValue)}
                        </span>
                      </div>

                      {/* Table */}
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                              <th style={{ padding: '12px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#374151' }}>Description</th>
                              <th style={{ padding: '12px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: '#374151' }}>Unit</th>
                              <th style={{ padding: '12px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#374151' }}>Qty</th>
                              <th style={{ padding: '12px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#374151' }}>Price</th>
                              <th style={{ padding: '12px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#374151' }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="row-reveal" style={{ borderBottom: '1px solid #f3f4f6', animationDelay: '950ms' }}>
                              <td style={{ padding: '12px', fontSize: 14, color: '#111827', textAlign: 'left' }}>Water Damage Restoration - Initial Assessment</td>
                              <td style={{ padding: '12px', textAlign: 'left', fontSize: 14, color: '#6b7280' }}>EA</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#111827' }}>1.00</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#111827' }}>$450.00</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, fontWeight: 600, color: '#111827' }}>$450.00</td>
                            </tr>
                            <tr className="row-reveal" style={{ borderBottom: '1px solid #f3f4f6', animationDelay: '1050ms' }}>
                              <td style={{ padding: '12px', fontSize: 14, color: '#111827', textAlign: 'left' }}>Structural Drying Equipment Setup</td>
                              <td style={{ padding: '12px', textAlign: 'left', fontSize: 14, color: '#6b7280' }}>EA</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#111827' }}>3.00</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#111827' }}>$125.00</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, fontWeight: 600, color: '#111827' }}>$375.00</td>
                            </tr>
                            <tr className="row-reveal" style={{ borderBottom: '1px solid #f3f4f6', animationDelay: '1150ms' }}>
                              <td style={{ padding: '12px', fontSize: 14, color: '#111827', textAlign: 'left' }}>Monitoring - Day 1</td>
                              <td style={{ padding: '12px', textAlign: 'left', fontSize: 14, color: '#6b7280' }}>EA</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#111827' }}>1.00</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#111827' }}>$100.00</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, fontWeight: 600, color: '#111827' }}>$100.00</td>
                            </tr>
                            <tr className="row-reveal" style={{ borderBottom: '1px solid #f3f4f6', animationDelay: '1250ms' }}>
                              <td style={{ padding: '12px', fontSize: 14, color: '#111827', textAlign: 'left' }}>Content Packout & Storage</td>
                              <td style={{ padding: '12px', textAlign: 'left', fontSize: 14, color: '#6b7280' }}>EA</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#111827' }}>2.00</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, color: '#111827' }}>$200.00</td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: 14, fontWeight: 600, color: '#111827' }}>$400.00</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Right Column - Summary */}
                  <div style={{
                    width: 280,
                    flexShrink: 0,
                  }}>
                    <div style={{
                      background: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 12,
                      padding: 20,
                      position: 'sticky',
                      top: 24,
                    }}>
                      <h3 style={{
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        fontSize: 16,
                        fontWeight: 600,
                        color: '#111827',
                        margin: 0,
                        marginBottom: 16,
                      }}>
                        Summary
                      </h3>

                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 12,
                        fontSize: 14,
                      }}>
                        <span style={{ color: '#6b7280' }}>Subtotal</span>
                        <span style={{ color: '#111827', fontWeight: 500 }}>{formatCurrency(subtotalValue)}</span>
                      </div>

                      <div style={{
                        width: '100%',
                        marginBottom: 12,
                        padding: '9px 0',
                        border: '1px dashed #d1d5db',
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#9ca3af',
                        textAlign: 'center',
                      }}>
                        + Add Premium/Discount
                      </div>

                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 12,
                        fontSize: 14,
                      }}>
                        <span style={{ color: '#6b7280' }}>Tax (8.5%)</span>
                        <span style={{ color: '#111827', fontWeight: 500 }}>{formatCurrency(taxValue)}</span>
                      </div>

                      <div className="summary-divider" style={{
                        height: 1,
                        background: '#e5e7eb',
                        margin: '16px 0',
                        animationDelay: '1650ms',
                      }}></div>

                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 8,
                        fontSize: 16,
                      }}>
                        <span style={{ color: '#111827', fontWeight: 600 }}>Total</span>
                        <span style={{ color: '#111827', fontWeight: 700, fontSize: 18 }}>{formatCurrency(totalValue)}</span>
                      </div>

                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: 16,
                        paddingTop: 16,
                        borderTop: '1px solid #e5e7eb',
                        fontSize: 14,
                      }}>
                        <span style={{ color: '#6b7280' }}>Amount Paid</span>
                        <span style={{ color: '#16a34a' }}>$0.00</span>
                      </div>

                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: 8,
                        fontSize: 14,
                      }}>
                        <span style={{ color: '#111827', fontWeight: 600 }}>Balance Due</span>
                        <span style={{ color: '#dc2626', fontWeight: 700 }}>{formatCurrency(totalValue)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Packing Estimate Spotlight */}
      <section id="packing-estimate" className="section" style={{ background: '#ffffff' }}>
        <div
          ref={packingReveal.ref}
          className={`container reveal${packingReveal.inView ? ' reveal-visible' : ''}`}
        >
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#9ca3af',
              marginBottom: 16,
              letterSpacing: '0.5px',
            }}>
              SPOTLIGHT: PACKING ESTIMATOR
            </div>
            <h2 className="headline section-title" style={{ fontSize: 32, fontWeight: 700, color: '#111827', marginBottom: 12 }}>
              From room photo to ready estimate — in 4 steps
            </h2>
            <p style={{ color: '#6b7280', fontSize: 17, maxWidth: 560, margin: '0 auto' }}>
              Our AI-powered Packing Estimator reads room photos, tags the contents, and calculates a full packout estimate. Try it right now with a real sample room — no account needed.
            </p>
          </div>

          <div
            className="process-rail packing-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 20,
              marginBottom: 48,
            }}
          >
            <div className="process-rail-fill" />
            {packingSteps.map((step, index) => (
              <div
                key={step.num}
                className={`process-step${index === 1 ? ' process-step--hero' : ''}`}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 20 }}
              >
                <div className="process-node">{step.num}</div>
                <div>
                  <h3
                    style={{
                      fontSize: index === 1 ? 20 : 17,
                      fontWeight: 700,
                      marginBottom: 8,
                      color: '#111827',
                      fontFamily: "'Plus Jakarta Sans', sans-serif",
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {step.title}
                  </h3>
                  <p style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.6 }}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center' }}>
            <button className="btn-primary" style={{ fontSize: 16, padding: '16px 32px' }} onClick={handleTryPackingDemo}>
              Try the Packing Estimator — Live Demo →
            </button>
            <p style={{ marginTop: 16, fontSize: 13, color: '#9ca3af' }}>
              No signup required · Real sample rooms
            </p>
            <button
              className="btn-link"
              style={{
                marginTop: 20,
                fontSize: 14,
                fontWeight: 600,
                color: '#111827',
                background: 'none',
                border: 'none',
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
              }}
              onClick={handleGetRealPackingEstimate}
            >
              Have your own space? Get a real photo-based estimate — free during beta →
            </button>
          </div>
        </div>
      </section>

      {/* Problem/Solution Section */}
      <section className="problem-section" style={{
        background: '#f9fafb',
        padding: '80px 20px',
      }}>
        <div
          ref={problemReveal.ref}
          className={`container reveal${problemReveal.inView ? ' reveal-visible' : ''}`}
        >
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 className="headline section-title" style={{ fontSize: 28, fontWeight: 700, color: '#111827', marginBottom: 12 }}>
              Still creating estimates in Excel?
            </h2>
            <p style={{ color: '#6b7280', fontSize: 17 }}>
              There's a better way.
            </p>
          </div>

          <div className="comparison-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 24,
            maxWidth: 800,
            margin: '0 auto',
          }}>
            <div style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 32,
              border: '1px solid #e5e7eb',
            }}>
              <div style={{ 
                fontSize: 13, 
                fontWeight: 600, 
                color: '#9ca3af', 
                marginBottom: 16,
                letterSpacing: '0.5px',
              }}>
                THE OLD WAY
              </div>
              <ul style={{ color: '#6b7280', lineHeight: 2.2, listStyle: 'none' }}>
                <li>30-40 minutes per estimate</li>
                <li>Copy-paste errors</li>
                <li>Inconsistent formatting</li>
                <li>Hard to look professional</li>
                <li>No tracking or history</li>
              </ul>
            </div>
            
            <div style={{
              background: '#111827',
              borderRadius: 12,
              padding: 32,
              color: 'white',
            }}>
              <div style={{ 
                fontSize: 13, 
                fontWeight: 600, 
                color: '#9ca3af', 
                marginBottom: 16,
                letterSpacing: '0.5px',
              }}>
                WITH SCOPIT
              </div>
              <ul style={{ color: '#e5e7eb', lineHeight: 2.2, listStyle: 'none' }}>
                <li>5 minutes per estimate</li>
                <li>Reusable line items</li>
                <li>Professional templates</li>
                <li>Branded PDF export</li>
                <li>Full history and tracking</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="section" style={{ background: '#ffffff' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <h2 className="headline section-title" style={{ fontSize: 32, fontWeight: 700, color: '#111827', marginBottom: 12 }}>
              Everything you need
            </h2>
            <p style={{ color: '#6b7280', fontSize: 17, maxWidth: 500, margin: '0 auto' }}>
              Simple tools that do exactly what you need. No bloat, no complexity.
            </p>
          </div>

          <div className="features-grid" ref={featuresReveal.ref} style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
          }}>
            {features.map((feature, index) => (
              <div
                key={index}
                className={`feature-card reveal${featuresReveal.inView ? ' reveal-visible' : ''}`}
                style={featuresReveal.inView ? { animationDelay: `${index * 40}ms` } : undefined}
              >
                <div style={{ color: '#111827', marginBottom: 16 }}>{feature.icon}</div>
                <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: '#111827' }}>
                  {feature.title}
                </h3>
                <p style={{ color: '#6b7280', fontSize: 15 }}>{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="how-it-works-section" style={{ background: '#f9fafb', padding: '100px 20px' }}>
        <div
          ref={howItWorksReveal.ref}
          className={`container reveal${howItWorksReveal.inView ? ' reveal-visible' : ''}`}
        >
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <h2 className="headline section-title" style={{ fontSize: 32, fontWeight: 700, color: '#111827', marginBottom: 12 }}>
              How it works
            </h2>
            <p style={{ color: '#6b7280', fontSize: 17 }}>
              Get started in minutes
            </p>
          </div>
          
          <div className="steps-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 48,
            maxWidth: 1000,
            margin: '0 auto',
          }}>
            {steps.map((step, index) => (
              <div key={index}>
                <div className="step-number" style={{
                  fontSize: 48,
                  fontWeight: 800,
                  color: '#e5e7eb',
                  marginBottom: 16,
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}>
                  {step.num}
                </div>
                <h3 className="step-title" style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: '#111827' }}>
                  {step.title}
                </h3>
                <p style={{ color: '#6b7280', fontSize: 15, lineHeight: 1.7 }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Beta CTA Section */}
      <section className="beta-section" style={{
        background: '#ffffff',
        padding: '100px 20px',
        borderTop: '1px solid #e5e7eb',
        borderBottom: '1px solid #e5e7eb',
      }}>
        <div
          ref={betaReveal.ref}
          className={`container reveal${betaReveal.inView ? ' reveal-visible' : ''}`}
          style={{ textAlign: 'center' }}
        >
          <h2 className="headline section-title" style={{
            fontSize: 32,
            fontWeight: 700,
            color: '#111827',
            marginBottom: 12
          }}>
            Join the beta
          </h2>
          <p style={{ color: '#6b7280', fontSize: 17, marginBottom: 40, maxWidth: 500, margin: '0 auto 40px' }}>
            Free access to all features during beta. Help us build the best estimating tool for contractors.
          </p>

          <div className="beta-card" style={{
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: 48,
            maxWidth: 500,
            margin: '0 auto',
          }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
                What you get
              </div>
              <ul style={{ 
                color: '#6b7280', 
                fontSize: 15, 
                listStyle: 'none',
                lineHeight: 2,
              }}>
                <li>All features included</li>
                <li>Unlimited estimates and invoices</li>
                <li>Priority support</li>
                <li>Early access to new features</li>
                <li>Special pricing at launch</li>
              </ul>
            </div>
            
            <button className="btn-primary" style={{
              width: '100%',
              padding: '16px',
              fontSize: 16,
            }} onClick={handleJoinBeta}>
              Get Started Free
            </button>
            
            <p style={{ marginTop: 16, fontSize: 13, color: '#9ca3af' }}>
              No credit card required
            </p>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="faq-section" style={{ background: '#ffffff', padding: '100px 20px' }}>
        <div className="container" style={{ maxWidth: 700 }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 className="headline section-title" style={{ fontSize: 32, fontWeight: 700, color: '#111827' }}>
              Questions
            </h2>
          </div>
          
          <div>
            {faqs.map((faq, index) => (
              <div 
                key={index} 
                className="faq-item"
                onClick={() => setOpenFaq(openFaq === index ? null : index)}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <h3 className="faq-question" style={{ fontSize: 17, fontWeight: 600, color: '#111827' }}>{faq.q}</h3>
                  <span style={{ 
                    fontSize: 20, 
                    color: '#9ca3af',
                    transform: openFaq === index ? 'rotate(45deg)' : 'none',
                    transition: 'transform 0.2s ease',
                    flexShrink: 0,
                    marginLeft: 16,
                  }}>+</span>
                </div>
                <div className="faq-answer" style={{ gridTemplateRows: openFaq === index ? '1fr' : '0fr' }}>
                  <div className="faq-answer-inner">
                    <p style={{ opacity: openFaq === index ? 1 : 0 }}>
                      {faq.a}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="cta-section" style={{
        background: '#111827',
        padding: '80px 20px',
        textAlign: 'center',
      }}>
        <div className="container">
          <h2 className="headline cta-title" style={{
            fontSize: 28,
            fontWeight: 700,
            color: 'white',
            marginBottom: 12
          }}>
            Ready to simplify your estimates?
          </h2>
          <p style={{ color: '#9ca3af', fontSize: 17, marginBottom: 32 }}>
            Join the beta and start creating professional estimates today.
          </p>
          <button className="btn-primary" style={{
            background: 'white',
            color: '#111827',
            fontSize: 16,
            padding: '16px 32px',
          }} onClick={handleJoinBeta}>
            Join Free Beta
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        background: '#111827',
        color: '#9ca3af',
        padding: '48px 20px 32px',
        borderTop: '1px solid #1f2937',
      }}>
        <div className="container">
          <div className="footer-content" style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 32,
            marginBottom: 32,
          }}>
            <div>
              <span className="headline" style={{ color: 'white', fontWeight: 700, fontSize: 18 }}>
                Scopit
              </span>
              <p style={{ fontSize: 14, marginTop: 8, maxWidth: 250 }}>
                Simple estimating software for restoration contractors.
              </p>
            </div>

            <div className="footer-links" style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: 'white', fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Product</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <a onClick={() => scrollToSection('features')} style={{ color: '#9ca3af', textDecoration: 'none', fontSize: 14, cursor: 'pointer' }}>Features</a>
                  <a onClick={() => scrollToSection('how-it-works')} style={{ color: '#9ca3af', textDecoration: 'none', fontSize: 14, cursor: 'pointer' }}>How it works</a>
                  <a onClick={() => scrollToSection('faq')} style={{ color: '#9ca3af', textDecoration: 'none', fontSize: 14, cursor: 'pointer' }}>FAQ</a>
                </div>
              </div>
              
              <div>
                <div style={{ color: 'white', fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Legal</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <a href="/privacy" style={{ color: '#9ca3af', textDecoration: 'none', fontSize: 14 }}>Privacy</a>
                  <a href="/terms" style={{ color: '#9ca3af', textDecoration: 'none', fontSize: 14 }}>Terms</a>
                </div>
              </div>
              
              <div>
                <div style={{ color: 'white', fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Contact</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <a href="mailto:hello@scopit.work" style={{ color: '#9ca3af', textDecoration: 'none', fontSize: 14 }}>hello@scopit.work</a>
                </div>
              </div>
            </div>
          </div>
          
          <div style={{
            borderTop: '1px solid #1f2937',
            paddingTop: 24,
            fontSize: 13,
            color: '#6b7280',
          }}>
            © 2026 Scopit. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
