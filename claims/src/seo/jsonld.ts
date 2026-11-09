/**
 * Structured data builders. Only facts we can stand behind: no ratings,
 * reviews, prices, or invented authors. FAQPage is built only from real Q&A
 * that appears on the page.
 */
import { SITE, absoluteUrl } from '../site';

export function organizationLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE.publisherUrl}/#organization`,
    name: SITE.publisher,
    url: SITE.publisherUrl,
    email: SITE.contactEmail,
    description:
      'Scopit makes estimating software for restoration contractors. It runs Scopit Claims, a free educational site.',
  };
}

export function websiteLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${absoluteUrl('/')}#website`,
    name: SITE.name,
    url: absoluteUrl('/'),
    description: SITE.description,
    inLanguage: 'en-US',
    publisher: { '@id': `${SITE.publisherUrl}/#organization` },
  };
}

export interface Crumb {
  name: string;
  path: string;
}

export function breadcrumbLd(crumbs: Crumb[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  };
}

export function articleLd(opts: {
  title: string;
  description: string;
  path: string;
  image: string;
  datePublished: string;
  dateModified: string;
  section: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: opts.title,
    description: opts.description,
    mainEntityOfPage: absoluteUrl(opts.path),
    url: absoluteUrl(opts.path),
    image: [absoluteUrl(opts.image)],
    datePublished: opts.datePublished,
    dateModified: opts.dateModified,
    articleSection: opts.section,
    inLanguage: 'en-US',
    isAccessibleForFree: true,
    author: { '@id': `${SITE.publisherUrl}/#organization` },
    publisher: { '@id': `${SITE.publisherUrl}/#organization` },
  };
}

export function faqLd(items: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}
