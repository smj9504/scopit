import React from 'react';
import { Link } from 'react-router-dom';
import { BoxIcon, HouseIcon, SearchIcon, PenIcon } from './icons';
import { BETA_END_LABEL } from './content';

const LAUNCHER_TOOLS = [
  { name: 'Packing & Moving', jobs: 'Interior · Moving', Icon: BoxIcon },
  { name: 'Roof Analyzer', jobs: 'Roofing', Icon: HouseIcon },
  { name: 'Item Recommender', jobs: 'All jobs', Icon: SearchIcon },
  { name: 'PDF & E-Sign', jobs: 'All jobs', Icon: PenIcon },
];

const HeroSection: React.FC = () => (
  <section className="lp-hero">
    <div className="lp-container lp-split">
      <div className="lp-hero__copy">
        <h1>Pack-outs, roofs, line items, signatures. One toolkit.</h1>
        <p className="lp-hero__sub">Each tool works on its own. Everything lands in your estimates and invoices.</p>
        <div className="lp-hero__ctas">
          <Link to="/register" className="lp-btn lp-btn--lg">Get started free</Link>
          <Link to="/demo/packing" className="lp-link">Try the packing demo</Link>
        </div>
        <p className="lp-note">Free through {BETA_END_LABEL}. No credit card.</p>
      </div>

      {/* Product picture of the in-app tool launcher; decorative, the copy carries the meaning. */}
      <div className="lp-launcher" aria-hidden="true">
        <div className="lp-launcher__body">
          <div className="lp-launcher__side">
            <span className="is-logo">Scopit</span>
            <span>Estimates</span>
            <span>Invoices</span>
            <span>Customers</span>
            <span className="is-on">Tools</span>
          </div>
          <div className="lp-launcher__grid">
            {LAUNCHER_TOOLS.map(({ name, jobs, Icon }) => (
              <div key={name} className="lp-tool-card" data-anim="tool-card">
                <Icon />
                <b>{name}</b>
                <small>{jobs}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </section>
);

export default HeroSection;
