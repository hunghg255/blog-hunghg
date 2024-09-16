import React, { useEffect } from 'react';
import mermaid from 'mermaid';
import { markdownItDiagramDom } from 'markdown-diagrams/dom';

const MermaidContent = () => {
  useEffect(() => {
    if (document) {
      const eleCopy = document.querySelectorAll('.markdown-it-mermaid');

      const init = async () => {
        mermaid.initialize({ startOnLoad: false, theme: 'light' });
        await mermaid.run();
        await markdownItDiagramDom();
      };

      init();

      setTimeout(() => {
        //@ts-ignore
        window.mediumZoom('[data-zoomable]');
      }, 300);
    }
  }, [location.href]);

  return <></>;
};

export default MermaidContent;
