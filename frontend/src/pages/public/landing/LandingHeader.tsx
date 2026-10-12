import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MenuIcon, CloseIcon } from './icons';

const SECTION_LINKS = [
  { href: '#tools', label: 'Tools' },
  { href: '#estimates', label: 'Estimates & invoices' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

const LandingHeader: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);

  return (
    <header className="lp-header">
      <div className="lp-container lp-header__bar">
        <a href="#top" className="lp-logo">Scopit</a>
        <nav className="lp-nav" aria-label="Primary">
          {SECTION_LINKS.map((l) => (
            <a key={l.href} href={l.href}>{l.label}</a>
          ))}
        </nav>
        <div className="lp-header__actions">
          <Link to="/login" className="lp-header__login">Log in</Link>
          <Link to="/register" className="lp-btn lp-btn--sm">Get started</Link>
          <button
            type="button"
            className="lp-menu-btn"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="lp-mobile-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav id="lp-mobile-nav" className="lp-mobile-nav" aria-label="Mobile">
          {SECTION_LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={close}>{l.label}</a>
          ))}
          <Link to="/login" onClick={close}>Log in</Link>
        </nav>
      )}
    </header>
  );
};

export default LandingHeader;
