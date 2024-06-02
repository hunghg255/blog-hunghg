---
title: React Provider Hell
authors: hunghg
tags: [react, provider]
image: https://res.cloudinary.com/practicaldev/image/fetch/s--HOQYtEP_--/c_imagga_scale,f_auto,fl_progressive,h_900,q_auto,w_1600/https://dev-to-uploads.s3.amazonaws.com/uploads/articles/kj81kq4qurtf84xrvtm8.png
date: '2023-09-19'
---

React Provider Hell

<!--truncate-->

## Issue

```jsx live noInline
const context1 = createContext({});
const context2 = createContext({});
const context3 = createContext({});
const context4 = createContext({});

const ChildApp = () => {
  const v1 = useContext(context1);
  const v2 = useContext(context2);
  const v3 = useContext(context3);
  const v4 = useContext(context4);

  return (
    <>
      <h2>ChildApp</h2>
      {v1.v}
      {v2.v}
      {v3.v}
      {v4.v}
    </>
  );
};

const App = () => {
  return (
    <>
      <context1.Provider value={{ v: 1 }}>
        <context2.Provider value={{ v: 2 }}>
          <context3.Provider value={{ v: 3 }}>
            <context4.Provider value={{ v: 4 }}>
              <ChildApp />
            </context4.Provider>
          </context3.Provider>
        </context2.Provider>
      </context1.Provider>
    </>
  );
};

render(<App />);
```

## Solution

```jsx live noInline
const context1 = createContext({});
const context2 = createContext({});
const context3 = createContext({});
const context4 = createContext({});

const ChildApp = () => {
  const v1 = useContext(context1);
  const v2 = useContext(context2);
  const v3 = useContext(context3);
  const v4 = useContext(context4);

  return (
    <>
      <h2>ChildApp</h2>
      {v1.v}
      {v2.v}
      {v3.v}
      {v4.v}
    </>
  );
};

import { cloneElement, memo } from 'react';

export interface ContextComposeProviderProps extends React.PropsWithChildren {
  contexts: React.ReactElement[]
}

export const ComposeContextProvider = memo(({
  contexts,
  children
}: ContextComposeProviderProps) => contexts.reduceRight<React.ReactNode>(
  (children: React.ReactNode, parent) => cloneElement(
    parent,
    { children }
  ),
  children
));

const contexts = [
  <context1.Provider value={ v: 1 } />,
  <context2.Provider value={ v: 2 } />,
  <context3.Provider value={ v: 3 } />,
  <context4.Provider value={ v: 4 } />,
];

const App = () => {
  return (
    <>
      <ComposeContextProvider contexts={contexts}>
        <ChildApp />
      </ComposeContextProvider>
    </>
  );
};

render(<App />);
```
