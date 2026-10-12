/**
 * Landing page motion. One authored moment (tool output landing in the
 * estimate) plus three supporting beats; each plays once when it scrolls in.
 *
 * Content is fully rendered without this hook: GSAP only sets start states
 * once it runs, and nothing runs under prefers-reduced-motion.
 */
import { RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { SAMPLE_ESTIMATE_TOTAL, formatUsd } from './content';

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function useLandingMotion(scope: RefObject<HTMLElement>) {
  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const q = gsap.utils.selector(root);

        // Hero: the launcher's tools appear as a list.
        gsap.from(q('[data-anim="tool-card"]'), {
          y: 10, autoAlpha: 0, duration: 0.5, stagger: 0.08, ease: 'expo.out', delay: 0.15,
        });

        // Job-type matrix: marks in reading order, then the estimates band wipes across.
        const matrix = q('[data-anim="matrix"]')[0];
        if (matrix) {
          const mq = gsap.utils.selector(matrix);
          gsap.timeline({ scrollTrigger: { trigger: matrix, start: 'top 75%', once: true } })
            .from(mq('.lp-jt-row .lp-jt-yes, .lp-jt-row .lp-jt-no'), {
              autoAlpha: 0, scale: 0.5, duration: 0.35, stagger: 0.045, ease: 'back.out(2)',
            })
            .from(mq('.lp-jt-base > *'), {
              clipPath: 'inset(0 100% 0 0)', duration: 0.3, stagger: 0.07, ease: 'expo.out',
            }, '+=0.05')
            .from(mq('.lp-jt-base .lp-jt-yes'), {
              autoAlpha: 0, scale: 0.5, duration: 0.3, stagger: 0.05, ease: 'back.out(2)',
            }, '-=0.15');
        }

        // E-sign: the signature is written stroke by stroke at pen speed.
        const doc = q('[data-anim="sig-doc"]')[0];
        if (doc) {
          const dq = gsap.utils.selector(doc);
          const paths = Array.from(doc.querySelectorAll<SVGPathElement>('[data-anim="sig-path"]'));
          const tl = gsap.timeline({ scrollTrigger: { trigger: doc, start: 'top 70%', once: true } });
          paths.forEach((p) => {
            const len = p.getTotalLength();
            gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
            tl.to(p, { strokeDashoffset: 0, duration: Math.max(0.1, len / 420), ease: 'none' }, '+=0.08');
          });
          tl.from(dq('[data-anim="sig-chip"]'), { autoAlpha: 0, duration: 0.25 });
        }

        // Focal moment: line items land in the estimate and the total tallies up.
        const estimate = q('[data-anim="estimate"]')[0];
        if (estimate) {
          const eq = gsap.utils.selector(estimate);
          const totalEl = eq('[data-anim="est-total"]')[0];
          const counter = { v: 0 };
          gsap.timeline({ scrollTrigger: { trigger: estimate, start: 'top 70%', once: true } })
            .from(eq('[data-anim="est-row"]'), { x: -20, autoAlpha: 0, duration: 0.45, stagger: 0.16, ease: 'expo.out' })
            .to(counter, {
              v: SAMPLE_ESTIMATE_TOTAL,
              duration: 0.8,
              ease: 'expo.out',
              onUpdate: () => {
                if (totalEl) totalEl.textContent = formatUsd(counter.v);
              },
            }, '-=0.25')
            .from(eq('[data-anim="est-convert"]'), { autoAlpha: 0, duration: 0.3 }, '-=0.2');
        }
      });
    },
    { scope },
  );
}
