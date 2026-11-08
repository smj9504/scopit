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

// Drawing colours match the roof plan below, so every mockup drawing reads as one set.
const INK = '#1e3a8a';
const BOX = '#dbeafe';
const APPLIANCE = '#eff6ff';

/** A door or drawer front: an inset panel with a pull. */
const Front: React.FC<{ x: number; y: number; w: number; h: number; pull: 'h' | 'v'; side?: 'l' | 'r' }> = ({
  x, y, w, h, pull, side = 'r',
}) => {
  const px = side === 'r' ? x + w - 5 : x + 5;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={INK} strokeWidth="1" />
      {pull === 'h'
        ? <path d={`M${x + w / 2 - 5} ${y + h / 2}h10`} stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        : <path d={`M${px} ${y + h - 13}v7`} stroke={INK} strokeWidth="1.6" strokeLinecap="round" />}
    </g>
  );
};

const CabinetSection: React.FC = () => (
  <section id="cabinets" className="lp-tool">
    <div className="lp-container lp-split lp-split--reverse">
      <div className="lp-tool__copy">
        <span className="lp-tool__meta">Cabinet Estimator · Interior</span>
        <h2 className="lp-tool__title">Sketch the kitchen. Price every box.</h2>
        <p className="lp-tool__body">
          Cabinets, countertop, demo, plumbing and install, priced off your layout. Restoration and upgrade options side by side.
        </p>
        <div className="lp-tool__ctas">
          <Link to="/register" className="lp-btn">Price a kitchen</Link>
          <span className="lp-note">3D view · PDF quote · Purchase order</span>
        </div>
      </div>
      <div className="lp-tray" aria-hidden="true">
        <div className="lp-sheet">
          <div className="lp-sheet__head">Kitchen · Sink wall elevation</div>
          <div className="lp-elev">
            <svg viewBox="0 0 320 166">
              <g stroke={INK} strokeWidth="1.5" strokeLinejoin="round">
                {/* Wall cabinets, the window over the sink, the hood over the range */}
                <rect x="16" y="12" width="54" height="52" fill={BOX} />
                <rect x="82" y="18" width="40" height="44" fill={APPLIANCE} />
                <path d="M102 18v44M82 40h40" strokeWidth="1" fill="none" />
                <rect x="132" y="12" width="44" height="52" fill={BOX} />
                <rect x="197" y="12" width="14" height="26" fill={APPLIANCE} />
                <polygon points="180,58 228,58 214,38 194,38" fill={APPLIANCE} />
                <rect x="232" y="12" width="72" height="52" fill={BOX} />
                {/* Base cabinets and appliances */}
                <rect x="16" y="102" width="54" height="48" fill={BOX} />
                <rect x="70" y="102" width="62" height="48" fill={BOX} />
                <rect x="132" y="102" width="44" height="54" fill="#ffffff" />
                <rect x="176" y="98" width="56" height="58" fill={APPLIANCE} />
                <rect x="186" y="120" width="36" height="24" fill={BOX} strokeWidth="1" />
                <rect x="232" y="102" width="72" height="48" fill={BOX} />
                {/* Toe kicks */}
                <rect x="19" y="150" width="48" height="6" fill="#bfdbfe" strokeWidth="1" />
                <rect x="73" y="150" width="56" height="6" fill="#bfdbfe" strokeWidth="1" />
                <rect x="235" y="150" width="66" height="6" fill="#bfdbfe" strokeWidth="1" />
              </g>
              <Front x={20} y={16} w={46} h={44} pull="v" />
              <Front x={136} y={16} w={36} h={44} pull="v" side="l" />
              <Front x={236} y={16} w={32} h={44} pull="v" />
              <Front x={268} y={16} w={32} h={44} pull="v" side="l" />
              <Front x={20} y={106} w={46} h={12} pull="h" />
              <Front x={20} y={121} w={46} h={13} pull="h" />
              <Front x={20} y={137} w={46} h={10} pull="h" />
              <rect x="74" y="106" width="54" height="10" fill="none" stroke={INK} strokeWidth="1" />
              <Front x={74} y={120} w={26} h={27} pull="v" />
              <Front x={102} y={120} w={26} h={27} pull="v" side="l" />
              <Front x={236} y={106} w={32} h={12} pull="h" />
              <Front x={270} y={106} w={30} h={12} pull="h" />
              <Front x={236} y={121} w={32} h={26} pull="v" />
              <Front x={270} y={121} w={30} h={26} pull="v" side="l" />
              <g stroke={INK} strokeLinecap="round" fill="none">
                <path d="M138 110h32" strokeWidth="1.6" />
                <path d="M188 113h32" strokeWidth="1.6" />
                <path d="M102 96v-10q0-4 4-4h5" strokeWidth="2" />
              </g>
              <g fill={INK}>
                {[187, 198, 209, 220].map((cx) => <circle key={cx} cx={cx} cy="105" r="2" />)}
                {/* Countertop, broken by the slide-in range */}
                <rect x="12" y="96" width="164" height="6" />
                <rect x="232" y="96" width="76" height="6" />
              </g>
              <path d="M8 156h304" stroke={INK} strokeWidth="1.5" />
            </svg>
          </div>
          <div className="lp-options">
            <div className="lp-option">
              <span className="lp-option__label">Restoration</span>
              <span className="lp-option__spec">Stock · Granite</span>
              <span className="lp-big-num">$16,480</span>
            </div>
            <div className="lp-option">
              <span className="lp-option__label">Upgrade option</span>
              <span className="lp-option__spec">Semi-Custom · Quartz</span>
              <span className="lp-big-num">$24,915</span>
              <span className="lp-option__diff">+$8,435 over restoration</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

// Phase names follow the Bathroom Estimator's own phases (PHASE_LABELS in its export service).
const BATH_PHASES: [string, string][] = [
  ['Demo & disposal', '$1,640.00'],
  ['Plumbing & electrical', '$2,180.00'],
  ['Substrate & waterproofing', '$1,420.00'],
  ['Tile & flooring', '$3,960.00'],
  ['Fixtures install', '$2,850.00'],
  ['Paint & trim', '$920.00'],
  ['Punch & cleanup', '$480.00'],
];

const BathroomSection: React.FC = () => (
  <section id="bathrooms" className="lp-tool">
    <div className="lp-container lp-split">
      <div className="lp-tool__copy">
        <span className="lp-tool__meta">Bathroom Estimator · Interior</span>
        <h2 className="lp-tool__title">Draw the bathroom. Price it phase by phase.</h2>
        <p className="lp-tool__body">
          Demo to punch list in seven phases, priced from your floor plan. For insurance restorations and remodels alike.
        </p>
        <div className="lp-tool__ctas">
          <Link to="/register" className="lp-btn">Price a bathroom</Link>
          <span className="lp-note">3D view · PDF with the sketch</span>
        </div>
      </div>
      <div className="lp-tray" aria-hidden="true">
        <div className="lp-sheet lp-bath">
          <div className="lp-sheet__head">Hall bath · 5′ × 8′</div>
          <div className="lp-bath__body">
            <div className="lp-bath__plan">
              <svg viewBox="0 0 150 240">
                <defs>
                  <pattern id="lp-bath-tile" width="12" height="12" patternUnits="userSpaceOnUse">
                    <path d="M12 0H0V12" fill="none" stroke={BOX} strokeWidth="1" />
                  </pattern>
                </defs>
                {/* Tiled floor inside the walls */}
                <rect x="4" y="4" width="142" height="232" fill="url(#lp-bath-tile)" stroke={INK} strokeWidth="3" />
                {/* Wall tile around the tub */}
                <path d="M8 82V8h134v74" fill="none" stroke="#93c5fd" strokeWidth="4" />
                <g stroke={INK} strokeWidth="1.5">
                  {/* Tub */}
                  <rect x="10" y="10" width="130" height="68" fill={BOX} />
                  <rect x="18" y="18" width="114" height="52" rx="18" fill={APPLIANCE} />
                  <circle cx="118" cy="44" r="3" fill="#ffffff" strokeWidth="1" />
                  {/* Toilet */}
                  <rect x="130" y="110" width="12" height="34" fill={BOX} />
                  <ellipse cx="115" cy="127" rx="14" ry="11" fill="#ffffff" />
                  {/* Vanity and sink */}
                  <rect x="6" y="148" width="36" height="58" fill={BOX} />
                  <ellipse cx="24" cy="177" rx="10" ry="15" fill="#ffffff" />
                </g>
                {/* Door and its swing */}
                <rect x="66" y="232" width="75" height="8" fill="#ffffff" />
                <path d="M66 236V161" stroke={INK} strokeWidth="2" />
                <path d="M66 161A75 75 0 0 1 141 236" fill="none" stroke={INK} strokeWidth="1" strokeDasharray="3 3" />
              </svg>
            </div>
            <ol className="lp-phases">
              {BATH_PHASES.map(([phase, amount], i) => (
                <li key={phase}>
                  <span className="lp-phases__n">{i + 1}</span>
                  <span>{phase}</span>
                  <span className="lp-num">{amount}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="lp-sheet__foot">
            <span style={{ fontWeight: 600 }}>Total</span>
            <span className="lp-big-num">$13,450.00</span>
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
    <CabinetSection />
    <BathroomSection />
    <RoofSection />
    <ItemsSection />
    <ESignSection />
  </div>
);

export default ToolSections;
