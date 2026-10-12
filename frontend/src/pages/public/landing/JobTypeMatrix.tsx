import React from 'react';
import { BoxIcon, HouseIcon, SearchIcon, PenIcon, DropletIcon, RoofIcon, TruckIcon, CheckIcon } from './icons';

const JOB_TYPES = [
  { long: 'Interior restoration', short: 'Interior', Icon: DropletIcon },
  { long: 'Roofing', short: 'Roofing', Icon: RoofIcon },
  { long: 'Moving & storage', short: 'Moving', Icon: TruckIcon },
];

// Columns follow JOB_TYPES order. Pack-out and roofing are separate job types.
const TOOL_ROWS = [
  { name: 'Packing & Moving', href: '#packing', Icon: BoxIcon, uses: [true, false, true] },
  { name: 'Roof Analyzer', href: '#roof', Icon: HouseIcon, uses: [false, true, false] },
  { name: 'Item Recommender', href: '#items', Icon: SearchIcon, uses: [true, true, true] },
  { name: 'PDF & E-Sign', href: '#esign', Icon: PenIcon, uses: [true, true, true] },
];

const Mark: React.FC<{ yes: boolean }> = ({ yes }) =>
  yes ? (
    <>
      <span className="lp-jt-yes"><CheckIcon /></span>
      <span className="lp-sr-only">Yes</span>
    </>
  ) : (
    <>
      <span className="lp-jt-no" />
      <span className="lp-sr-only">No</span>
    </>
  );

const JobTypeMatrix: React.FC = () => (
  <section className="lp-jobs">
    <div className="lp-container">
      <h2 className="lp-h2" style={{ maxWidth: 640 }}>Use the tools your jobs need</h2>
      <div className="lp-jt-card" data-anim="matrix">
        <table className="lp-jt">
          <caption className="lp-sr-only">Which Scopit tools each job type uses</caption>
          <colgroup>
            <col className="lp-jt__tool" />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col"><span className="lp-sr-only">Tool</span></th>
              {JOB_TYPES.map(({ long, short, Icon }) => (
                <th scope="col" key={long}>
                  <div className="lp-jt__head">
                    <span className="lp-jt__icon"><Icon size={24} /></span>
                    <span className="lp-jt__label">
                      <span className="lp-jt__long">{long}</span>
                      <span className="lp-jt__short" aria-hidden="true">{short}</span>
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TOOL_ROWS.map(({ name, href, Icon, uses }) => (
              <tr className="lp-jt-row" key={name}>
                <th scope="row">
                  <a className="lp-jt__tool-link" href={href}><Icon /><span>{name}</span></a>
                </th>
                {uses.map((yes, i) => (
                  <td key={i}><Mark yes={yes} /></td>
                ))}
              </tr>
            ))}
            <tr className="lp-jt-gap" aria-hidden="true"><td colSpan={4} /></tr>
            <tr className="lp-jt-base">
              <th scope="row">
                <a href="#estimates"><span>Estimates &amp; invoices</span><small>Where every tool lands</small></a>
              </th>
              {JOB_TYPES.map(({ long }) => (
                <td key={long}><Mark yes /></td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
);

export default JobTypeMatrix;
