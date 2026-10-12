import React from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon } from './icons';
import { BETA_END_LABEL, FAQS, PROOF_STATS, TESTIMONIALS } from './content';

export const ProofSection: React.FC = () => {
  if (TESTIMONIALS.length === 0 && PROOF_STATS.length === 0) return null;
  return (
    <section className="lp-proof" aria-label="What beta users say">
      <div className="lp-container">
        {TESTIMONIALS.map((t) => (
          <figure className="lp-quote" key={t.quote}>
            <blockquote>{t.quote}</blockquote>
            <figcaption>{t.name}, {t.role}</figcaption>
          </figure>
        ))}
        {PROOF_STATS.map((s) => (
          <div className="lp-stat" key={s.label}>
            <b>{s.value}</b>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
};

const PRICE_POINTS = ['Every tool included', 'Unlimited estimates and invoices', 'Your data stays when we launch'];

export const PricingSection: React.FC = () => (
  <section id="pricing" className="lp-pricing">
    <div className="lp-container">
      <h2 className="lp-h2">Free through {BETA_END_LABEL}</h2>
      <div className="lp-price-card">
        <span className="lp-price-card__amount">$0</span>
        <ul>
          {PRICE_POINTS.map((p) => (
            <li key={p}><CheckIcon size={18} strokeWidth={2.5} />{p}</li>
          ))}
        </ul>
        <Link to="/register" className="lp-btn lp-btn--lg">Get started free</Link>
      </div>
      <p className="lp-note">Beta users get special pricing at launch.</p>
    </div>
  </section>
);

export const FaqSection: React.FC = () => (
  <section id="faq" className="lp-faq">
    <div className="lp-container">
      <h2 className="lp-h2">Questions</h2>
      <dl>
        {FAQS.map((f) => (
          <div className="lp-faq__item" key={f.q}>
            <dt>{f.q}</dt>
            <dd>{f.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  </section>
);

export const FinalCta: React.FC = () => (
  <section className="lp-final">
    <div className="lp-container">
      <h2>Start with the tool you need today.</h2>
      <Link to="/register" className="lp-btn lp-btn--lg lp-btn--light">Get started free</Link>
    </div>
  </section>
);

export const LandingFooter: React.FC = () => (
  <footer className="lp-footer">
    <div className="lp-container">
      <div className="lp-footer__cols">
        <div className="lp-footer__brand"><span className="lp-logo" style={{ fontSize: 20 }}>Scopit</span></div>
        <nav aria-label="Tools">
          <b>Tools</b>
          <a href="#packing">Packing &amp; Moving</a>
          <a href="#roof">Roof Analyzer</a>
          <a href="#items">Item Recommender</a>
          <a href="#esign">PDF &amp; E-Sign</a>
        </nav>
        <nav aria-label="Guides">
          <b>Guides</b>
          <Link to="/packing-calculator">Packing calculator</Link>
          <Link to="/pack-out-estimate">Pack-out estimate</Link>
          <Link to="/insurance-packing-estimate">Insurance packing estimate</Link>
          <Link to="/packing-report">Packing report</Link>
        </nav>
        <nav aria-label="Company">
          <b>Company</b>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <a href="mailto:hello@scopit.work">hello@scopit.work</a>
        </nav>
      </div>
      <p className="lp-footer__copy">© 2026 Scopit</p>
    </div>
  </footer>
);
