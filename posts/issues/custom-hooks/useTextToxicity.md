---
sidebar_position: 15
title: useTextToxicity
comment: true
tags:
  - Reactjs
  - Custom Hook
  - useTextToxicity
date: '2024-06-08'
---

```jsx
import { useEffect, useRef, useState } from 'react';
import * as toxicity from '@tensorflow-models/toxicity';

export default function useTextToxicity(text, { threshold = 0.9, delay = 300 } = {}) {
  const [predictions, setPredictions] = useState(null);
  const model = useRef();

  async function predict() {
    if (!text) return;
    model.current = model.current || (await toxicity.load());
    const result = await model.current.classify([text]).catch(() => {});

    if (!result) return;

    setPredictions(
      result.map((prediction) => {
        const [{ match, probabilities }] = prediction.results;
        return {
          label: prediction.label,
          match,
          probabilities,
          probability: (probabilities[1] * 100).toFixed(2) + '%',
        };
      }),
    );
  }

  useEffect(() => {
    const timeout = setTimeout(predict, delay);
    return () => clearTimeout(timeout);
  }, [threshold, text, delay]);

  return predictions;
}
```
