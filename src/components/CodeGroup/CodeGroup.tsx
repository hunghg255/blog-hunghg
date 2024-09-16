//@ts-nocheck
import React, { useEffect } from 'react';
import { markdownItCodeGroupDom } from 'markdown-it-code-group/dom'

const CodeGroup = () => {
  useEffect(() => {
    const t = setTimeout(() => {
      if (document) {
        markdownItCodeGroupDom()
      }

      clearTimeout(t);
    }, 300);
  }, [location.href]);

  return <></>;
};

export default CodeGroup;
