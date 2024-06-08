---
sidebar_position: 15
title: useNavigatorLanguage
comment: true
tags:
  - Reactjs
  - Custom Hook
  - useNavigatorLanguage
date: '2024-06-08'
---

```jsx
import { useEffect, useRef, useState } from 'react';
import * as toxicity from '@tensorflow-models/toxicity';

const subscribe = (onStoreChange) => {
  window.addEventListener('languagechange', onStoreChange);
  return () => window.removeEventListener('languagechange', onStoreChange);
};

const getSnapshot = () => {
  return window.navigator.languages;
};

const useNavigatorLanguage = () => {
  return useSyncExternalStore(subscribe, getSnapshot);
};
```
