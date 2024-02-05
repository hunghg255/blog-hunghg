import React, { useEffect } from 'react';
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

  return <></>;
};

export default CopyContent;
