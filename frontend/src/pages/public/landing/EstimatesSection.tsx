import React from 'react';
import { SAMPLE_ESTIMATE, SAMPLE_ESTIMATE_TOTAL, formatUsd } from './content';

/** The home base: a sample estimate the tools feed into. Animated by useLandingMotion. */
const EstimatesSection: React.FC = () => (
  <section id="estimates" className="lp-home">
    <div className="lp-container lp-split">
      <div className="lp-home__copy">
        <h2 className="lp-h2">Every tool lands here.</h2>
        <p>Branded estimates, one click to invoice, payments recorded.</p>
        <p className="lp-home__soon">Coming soon: roof estimates and recommended line items, straight into an estimate.</p>
      </div>
      <div className="lp-estimate" data-anim="estimate" aria-label="Sample estimate">
        <div className="lp-estimate__head">
          <b>Estimate {SAMPLE_ESTIMATE.number}</b>
          <span>{SAMPLE_ESTIMATE.context}</span>
        </div>
        {SAMPLE_ESTIMATE.rows.map((row) => (
          <div className="lp-est-row" data-anim="est-row" key={row.label}>
            <span>
              <span>{row.label}</span>
              {row.source && <span className="lp-pill lp-pill--info">{row.source}</span>}
            </span>
            <span className="lp-num">{formatUsd(row.amount)}</span>
          </div>
        ))}
        <div className="lp-estimate__foot">
          <span className="lp-estimate__total" data-anim="est-total">{formatUsd(SAMPLE_ESTIMATE_TOTAL)}</span>
          <span className="lp-estimate__convert" data-anim="est-convert" aria-hidden="true">Convert to invoice</span>
        </div>
      </div>
    </div>
  </section>
);

export default EstimatesSection;
