import React, { useEffect } from 'react';
import { svgCopy, svgTick } from '~utils/svg';

const CodeGroup = () => {
  useEffect(() => {
    if (document) {
      const t = setTimeout(() => {
        const eleCodeGroups = document.querySelectorAll('.markdown-code-group');

        const removeCodeBlockClass = (el: any) => {
          const codeBlocks = el.querySelectorAll('.code-blocks-group');
          codeBlocks.forEach((el: any) => {
            el.classList.remove('active');
          });
        };
        const removeTabClass = (el: any) => {
          const codeBlocks = el.querySelectorAll('.markdown-group-tab-item');
          codeBlocks.forEach((el: any) => {
            el.classList.remove('active');
          });
        };

        if (eleCodeGroups?.length) {
          eleCodeGroups.forEach((el: any) => {
            const btns = el.querySelectorAll('.markdown-group-tab-item');

            btns.forEach((btn: any) => {
              btn.addEventListener('click', () => {
                const pkgType = btn.dataset.pkg;

                removeCodeBlockClass(el);
                removeTabClass(el);

                const code = el.querySelector(`.code-blocks-group.${pkgType}`);
                code.classList.add('active');
                btn.classList.add('active');
              });
            });
          });
        }

        clearTimeout(t);
      }, 1000);
    }
  }, [location.href]);

  return <></>;
};

export default CodeGroup;
