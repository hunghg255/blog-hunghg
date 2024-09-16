import React, { useEffect } from 'react';
//@ts-expect-error
import mermaid from 'mermaid';
// mermaid.initialize({ startOnLoad: true, theme: 'dark' });
//@ts-expect-error
import { markdownItDiagramDom } from 'markdown-diagrams/dom'
const MermaidContent = () => {
  useEffect(() => {
    if (document) {
      const eleCopy = document.querySelectorAll('.markdown-it-mermaid');

      const init = async () => {
        mermaid.initialize({ startOnLoad: false, theme: 'light' })
        await mermaid.run()
        // initialize markdown-it-diagram/dom script
        await markdownItDiagramDom()
      }

      init()

      setTimeout(() => {
        //@ts-ignore
        window.mediumZoom('[data-zoomable]');
      }, 300);
    }
  }, [location.href]);

  return <></>;
};

export default MermaidContent;
