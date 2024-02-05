import React, { useEffect } from 'react';

const CodeGroup = () => {
  useEffect(() => {
    const t = setTimeout(() => {
      if (document) {
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

        const initCodeGroupActive = (el: any) => {
          const tabActive = el.querySelector('.markdown-group-tab-item.active');
          const dataCodeGroupActive = tabActive?.dataset.codeGroup;

          const codeActive = el.querySelector(`.code-blocks-group.${dataCodeGroupActive}`);

          if (codeActive) {
            codeActive.classList.add('active');
          }
        };

        if (eleCodeGroups?.length) {
          eleCodeGroups.forEach((el: any) => {
            const btns = el.querySelectorAll('.markdown-group-tab-item');

            initCodeGroupActive(el);

            btns.forEach((btn: any) => {
              btn.addEventListener('click', () => {
                const dataCodeGroup = btn.dataset.codeGroup;

                removeCodeBlockClass(el);
                removeTabClass(el);

                const code = el.querySelector(`.code-blocks-group.${dataCodeGroup}`);
                code.classList.add('active');
                btn.classList.add('active');
              });
            });
          });
        }
      }

      clearTimeout(t);
    }, 300);
  }, [location.href]);

  return <></>;
};

export default CodeGroup;
