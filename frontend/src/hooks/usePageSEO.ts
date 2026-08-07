import { useEffect } from 'react';

interface PageSEOOptions {
  title: string;
  description: string;
  path: string;
}

const SITE_URL = 'https://scopit.work';

function setMetaByName(name: string, content: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function setMetaByProperty(property: string, content: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('property', property);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

/**
 * Sets document title, meta description, canonical link, and OG/Twitter tags
 * for the current route. Restores the index.html defaults on unmount so
 * navigating away (e.g. back to "/") doesn't leak a stale title.
 */
export function usePageSEO({ title, description, path }: PageSEOOptions) {
  useEffect(() => {
    const url = `${SITE_URL}${path}`;
    const previousTitle = document.title;

    document.title = title;
    setMetaByName('description', description);
    setMetaByProperty('og:title', title);
    setMetaByProperty('og:description', description);
    setMetaByProperty('og:url', url);
    setMetaByName('twitter:title', title);
    setMetaByName('twitter:description', description);
    setMetaByName('twitter:url', url);

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', url);

    return () => {
      document.title = previousTitle;
    };
  }, [title, description, path]);
}
