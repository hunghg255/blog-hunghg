import { computePosition, offset } from '@floating-ui/dom';
import { useEffect } from 'react';
import { svgCopy, svgTick } from '~utils/svg';
import { copyContent, getTextExcept } from '~utils/utils';

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
    const t = setTimeout(() => {
      if (document) {
        const eleTwoslash = document.querySelectorAll(
          '.twoslash-hover:not(.twoslash-query-presisted)',
        );
        const eleTwoslashCursor = document.querySelectorAll('.twoslash-completion-cursor');
        const eleTwoslashPersisted = document.querySelectorAll('.twoslash-query-presisted');
        const updates: any = [];

        if (eleTwoslash?.length) {
          eleTwoslash.forEach((el) => {
            const twpslashEle = el.querySelector('.twoslash-popup-container') as any;

            const update = () => {
              computePosition(el, twpslashEle, {
                strategy: 'fixed',
                placement: 'bottom-start',
                middleware: [offset(0)],
              }).then(({ x, y }) => {
                Object.assign(twpslashEle.style, {
                  left: `${x}px`,
                  top: `${y}px`,
                });
              });
            };

            function showTooltip() {
              twpslashEle.style.display = 'block';
              twpslashEle.style.zIndex = '9999';
              update();
            }

            function hideTooltip() {
              twpslashEle.style.display = '';
            }

            [
              ['mouseenter', showTooltip],
              ['mouseleave', hideTooltip],
              ['focus', showTooltip],
              ['blur', hideTooltip],
            ].forEach(([event, listener]) => {
              el.addEventListener(event as any, listener as any);
            });
          });
        }
        if (eleTwoslashCursor?.length) {
          eleTwoslashCursor.forEach((el) => {
            const twpslashEle = el.querySelector('.twoslash-completion-list') as any;

            const update = () => {
              computePosition(el, twpslashEle, {
                strategy: 'fixed',
                placement: 'bottom-start',
                middleware: [offset(1)],
              }).then(({ x, y }) => {
                Object.assign(twpslashEle.style, {
                  left: `${x}px`,
                  top: `${y}px`,
                });
              });
            };

            function showTooltip() {
              twpslashEle.style.display = 'inline-flex';
              update();
            }
            showTooltip();
            updates.push(update);
          });
        }
        if (eleTwoslashPersisted?.length) {
          eleTwoslashPersisted.forEach((el) => {
            const twpslashEle = el.querySelector('.twoslash-popup-container') as any;

            const update = () => {
              computePosition(el, twpslashEle, {
                strategy: 'fixed',
                placement: 'bottom-start',
                middleware: [offset(1)],
              }).then(({ x, y }) => {
                Object.assign(twpslashEle.style, {
                  left: `${x}px`,
                  top: `${y}px`,
                });
              });
            };
            updates.push(update);

            function showTooltip() {
              twpslashEle.style.display = 'block';
              update();
            }

            showTooltip();
          });
        }

        window.addEventListener('scroll', () => {
          updates.forEach((update: any) => {
            update();
          });
        });
        window.addEventListener('resize', () => {
          updates.forEach((update: any) => {
            update();
          });
        });
      }

      clearTimeout(t);
    }, 300);
  }, [location.href]);

  return <></>;
};

export default CopyContent;
