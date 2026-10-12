import React from 'react';
import { Link } from 'react-router-dom';
import { SearchIcon } from './icons';

// Mockup values are illustrative sample data, not customer figures.

const PackingSection: React.FC = () => (
  <section id="packing" className="lp-tool lp-tool--first">
    <div className="lp-container lp-split">
      <div className="lp-tool__copy">
        <span className="lp-tool__meta">Packing &amp; Moving Estimator · Interior · Moving</span>
        <h2 className="lp-tool__title">Room photos in. Priced pack-out out.</h2>
        <p className="lp-tool__body">Labor, materials, moving and storage, at your own rates.</p>
        <div className="lp-tool__ctas">
          <Link to="/demo/packing" className="lp-btn">Launch live demo</Link>
          <span className="lp-note">No signup · Photo AI in beta</span>
        </div>
      </div>
      <div className="lp-tray" aria-hidden="true">
        <div className="lp-sheet">
          <div className="lp-sheet__head">Living room · Kitchen · Bedroom — 224 items</div>
          <div className="lp-sheet__rows">
            <div className="lp-sheet__row"><span>Packing labor</span><span className="lp-num">$1,295.00</span></div>
            <div className="lp-sheet__row"><span>Materials</span><span className="lp-num">$486.40</span></div>
            <div className="lp-sheet__row"><span>Moving</span><span className="lp-num">$1,150.00</span></div>
            <div className="lp-sheet__row"><span>Storage</span><span className="lp-num">$1,080.00</span></div>
          </div>
          <div className="lp-sheet__foot">
            <span style={{ fontWeight: 600 }}>Total</span>
            <span className="lp-big-num">$4,011.40</span>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const RoofSection: React.FC = () => (
  <section id="roof" className="lp-tool">
    <div className="lp-container lp-split lp-split--reverse">
      <div className="lp-tool__copy">
        <span className="lp-tool__meta">Roof Analyzer · Roofing</span>
        <h2 className="lp-tool__title">Read an EagleView report in seconds.</h2>
        <p className="lp-tool__body">Every face, slope and area, laid out for you.</p>
        <div className="lp-soon"><b>Coming soon</b><span>Priced roof estimates from these numbers</span></div>
        <Link to="/register" className="lp-btn">Analyze a roof report</Link>
      </div>
      <div className="lp-tray" aria-hidden="true">
        <div className="lp-sheet">
          <div className="lp-roof-plan">
            <svg viewBox="0 0 320 200">
              <polygon points="20,20 300,20 220,100 100,100" fill="#dbeafe" stroke="#1e3a8a" strokeWidth="1.5" />
              <polygon points="20,180 300,180 220,100 100,100" fill="#bfdbfe" stroke="#1e3a8a" strokeWidth="1.5" />
              <polygon points="20,20 100,100 20,180" fill="#eff6ff" stroke="#1e3a8a" strokeWidth="1.5" />
              <polygon points="300,20 220,100 300,180" fill="#eff6ff" stroke="#1e3a8a" strokeWidth="1.5" />
              {[['A', 160, 62], ['B', 160, 150], ['C', 48, 106], ['D', 272, 106]].map(([label, x, y]) => (
                <text key={label} x={x} y={y} textAnchor="middle" fontSize="16" fontWeight="700" fill="#1e3a8a" fontFamily="Inter, sans-serif">
                  {label}
                </text>
              ))}
            </svg>
          </div>
          <div className="lp-sheet__foot">
            <span style={{ fontSize: 14, color: 'var(--lp-text-2)' }}>4 faces · 8/12 pitch</span>
            <span className="lp-big-num" style={{ fontSize: 20 }}>1,700 sq ft · 17.0 sq</span>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const ItemsSection: React.FC = () => (
  <section id="items" className="lp-tool">
    <div className="lp-container lp-split">
      <div className="lp-tool__copy">
        <span className="lp-tool__meta">Item Recommender · All jobs</span>
        <h2 className="lp-tool__title">The line items for the work, grouped the way it runs.</h2>
        <p className="lp-tool__body">Search by work type. Get pre-work, main, materials, trim and post-work.</p>
        <Link to="/register" className="lp-btn">Find line items</Link>
      </div>
      <div className="lp-tray" aria-hidden="true">
        <div className="lp-sheet lp-items">
          <div className="lp-search">
            <span style={{ color: 'var(--lp-muted)', display: 'inline-flex' }}><SearchIcon size={16} /></span>
            <span>Replace wet drywall</span>
          </div>
          <dl className="lp-items__grid">
            <dt>Pre-work</dt><dd>Tear out wet drywall</dd>
            <dt>Main</dt><dd>Drywall — hung, taped, ready for paint</dd>
            <dt>Trim</dt><dd>Baseboard — detach &amp; reset</dd>
            <dt>Post-work</dt><dd>Seal &amp; paint walls</dd>
          </dl>
        </div>
      </div>
    </div>
  </section>
);

const ESignSection: React.FC = () => (
  <section id="esign" className="lp-tool lp-tool--last">
    <div className="lp-container lp-split lp-split--reverse">
      <div className="lp-tool__copy">
        <span className="lp-tool__meta">PDF &amp; E-Sign · All jobs</span>
        <h2 className="lp-tool__title">Signed before you leave the driveway.</h2>
        <p className="lp-tool__body">Forms fill themselves from your records. Send for signature by link.</p>
        <div className="lp-tool__ctas">
          <Link to="/register" className="lp-btn">Send a document to sign</Link>
          <Link to="/in-person-contract-signing" className="lp-link">How on-site signing works</Link>
        </div>
      </div>
      <div className="lp-tray" aria-hidden="true">
        <div className="lp-doc" data-anim="sig-doc">
          <div className="lp-doc__title">Work Authorization</div>
          <div className="lp-doc__field">
            <span><span style={{ color: 'var(--lp-text-2)' }}>Customer</span> Johnson Residence</span>
            <em>Auto-filled</em>
          </div>
          <div className="lp-doc__lines">
            <span />
            <span style={{ width: '92%' }} />
            <span style={{ width: '64%' }} />
          </div>
          <div className="lp-doc__sign">
            <div className="lp-doc__sign-box">
              <svg viewBox="0 0 240 70">
                <g fill="none" stroke="#1e293b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path data-anim="sig-path" d="M14 54 C 18 42, 22 24, 27 10 C 30 4, 44 6, 42 18 C 40 28, 26 30, 24 28 C 32 34, 38 46, 46 54 C 49 57, 53 55, 55 52" />
                  <path data-anim="sig-path" d="M60 52 l 1.6 0.6" />
                  <path data-anim="sig-path" d="M76 14 C 84 12, 92 12, 98 13 M 91 13 C 90 30, 88 50, 80 60 C 74 66, 66 62, 70 56 C 74 50, 86 48, 96 46 C 100 40, 108 36, 108 42 C 108 48, 100 48, 101 42 C 102 38, 108 40, 112 40 C 116 34, 120 16, 117 12 C 113 10, 111 30, 112 46 C 114 38, 122 34, 124 40 C 125 44, 124 46, 126 46 C 128 40, 132 36, 134 40 C 135 43, 134 46, 136 46 C 138 40, 143 36, 145 40 C 146 44, 145 46, 148 46 C 150 42, 154 38, 156 40 C 158 43, 150 46, 152 47 C 156 48, 158 45, 160 44 C 162 38, 170 36, 170 42 C 170 48, 162 48, 163 42 C 164 38, 170 40, 174 40 C 176 40, 180 36, 182 40 C 183 43, 182 46, 184 46 C 186 40, 191 36, 193 40 C 194 44, 193 46, 198 46 C 210 46, 222 40, 228 34" />
                  <path data-anim="sig-path" d="M66 62 C 110 57, 170 55, 232 51" />
                </g>
              </svg>
              <div className="lp-doc__sign-line">Homeowner signature</div>
            </div>
            <span className="lp-pill lp-pill--ok" data-anim="sig-chip">Signed · Oct 3</span>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const ToolSections: React.FC = () => (
  <div id="tools">
    <PackingSection />
    <RoofSection />
    <ItemsSection />
    <ESignSection />
  </div>
);

export default ToolSections;
