import { useEffect } from 'react';
import { svgCopy, svgTick } from '~utils/svg';
import { copyContent, getTextExcept } from '~utils/utils';
import { createTooltip, destroyTooltip, recomputeAllPoppers } from 'floating-ui';

const CopyContent = () => {
  useEffect(() => {
    const t = setTimeout(() => {
      if (document) {
        const eleCopy = document.querySelectorAll('.markdown-it-code-copy');

        if (eleCopy?.length) {
          eleCopy.forEach((el) => {
            const btn = el.querySelector('.btn-copy') as HTMLButtonElement;
            btn.addEventListener('click', () => {
              const content = getTextExcept(el.querySelector('pre'), '.ingore-twoslash');

              copyContent(content);
              btn.innerHTML = svgTick;
              const t = setTimeout(() => {
                btn.innerHTML = svgCopy;
                clearTimeout(t);
              }, 1200);
            });
          });
        }
      }

      clearTimeout(t);
    }, 300);
  }, [location.href]);

  useEffect(() => {
    const tooltips: any = [];
    const t = setTimeout(() => {
      if (typeof window !== 'undefined') {
        // Recompute poppers when clicking on a tab
        window.addEventListener(
          'click',
          (e) => {
            // const path = e.composedPath();
            // if (
            //   path.some(
            //     (el: any) =>
            //       el?.classList?.contains?.('vp-code-group') || el?.classList?.contains?.('tabs'),
            //   )
            // )
            //   recomputeAllPoppers();
            recomputeAllPoppers();
          },
          { passive: true },
        );
      }

      const isMobile =
        typeof navigator !== 'undefined' &&
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      if (document) {
        const eleTwoslash = document.querySelectorAll(
          '.twoslash-hover:not(.twoslash-query-presisted)',
        );
        const eleTwoslashCursor = document.querySelectorAll('.twoslash-completion-cursor');
        const eleTwoslashPersisted = document.querySelectorAll('.twoslash-query-presisted');

        if (eleTwoslash?.length) {
          eleTwoslash.forEach((el) => {
            const twpslashEle = el.querySelector('.twoslash-popup-container') as any;

            const tooltip = createTooltip(
              el,
              {
                content: twpslashEle.outerHTML,
                html: true,
                triggers: isMobile ? ['touch'] : ['hover', 'touch'],
                popperTriggers: isMobile ? ['touch'] : ['hover', 'touch'],
                placement: 'bottom-start',
                overflowPadding: 10,
                delay: 0,
                handleResize: false,
                autoHide: true,
                instantMove: true,
                flip: false,
                arrowPadding: 8,
                autoBoundaryMaxSize: true,
                popperClass: 'v-popper--theme-twoslash',
              },
              {},
            );
          });
        }
        if (eleTwoslashCursor?.length) {
          eleTwoslashCursor.forEach((el) => {
            const twpslashEle = el.querySelector('.twoslash-completion-list') as any;

            const tooltip = createTooltip(
              el,
              {
                content: twpslashEle.outerHTML,
                html: true,
                triggers: ['click'],
                popperTriggers: ['click'],
                placement: 'bottom-start',
                autoHide: false,
                distance: 0,
                arrowOverflow: true,
                popperClass: 'v-popper--theme-twoslash twoslash-floating-hide',
              },
              {},
            );

            tooltip.show();

            tooltips.push(el);
          });
        }
        if (eleTwoslashPersisted?.length) {
          eleTwoslashPersisted.forEach((el) => {
            const twpslashEle = el.querySelector('.twoslash-popup-container') as any;

            const tooltip = createTooltip(
              el,
              {
                content: twpslashEle.outerHTML,
                html: true,
                triggers: ['click'],
                popperTriggers: ['click'],
                placement: 'bottom-start',
                autoHide: false,
                popperClass: 'v-popper--theme-twoslash',
              },
              {},
            );

            tooltip.show();

            tooltips.push(el);
          });
        }
      }

      clearTimeout(t);
    }, 100);

    return () => {
      if (t) clearTimeout(t);
      recomputeAllPoppers();
      if (tooltips.length)
        tooltips.forEach((tooltip: any) => {
          destroyTooltip(tooltip);
        });
    };
  }, [location.href]);

  return <></>;
};

export default CopyContent;
