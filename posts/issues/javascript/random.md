---
sidebar_position: 1
title: Random
comment: true
tags:
  - Javascript
  - 1loc
  - Random
date: '2023-03-21'
---

## Generate a random integer in given range

:::code-group-open

```js
const randomInteger = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
```

```ts
const randomInteger = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;
```

:::code-group-close

## Sort an object by its properties

:::code-group-open

```js
const sort = (obj) =>
  Object.keys(obj)
    .sort()
    .reduce((p, c) => ((p[c] = obj[c]), p), {});

// Example
const colors = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
};
sort(colors);
/*
{
    black: '#000000',
    blue: '#0000ff',
    green: '#008000',
    red: '#ff0000',
    white: '#ffffff',
}
*/
```

:::code-group-close

## Generate a random hex color

:::code-group-open

```js
const randomColor = () => `#${Math.random().toString(16).slice(2, 8).padEnd(6, '0')}`;

// Or
const randomColor = () => `#${(~~(Math.random() * (1 << 24))).toString(16)}`;
```

```ts
const randomColor = (): string => `#${Math.random().toString(16).slice(2, 8).padEnd(6, '0')}`;

// Or
const randomColor = (): string => `#${(~~(Math.random() * (1 << 24))).toString(16)}`;
```

:::code-group-close

## Generate a random string from given characters

:::code-group-open

```js
const generateString = (length, chars) =>
  Array(length)
    .fill('')
    .map((v) => chars[Math.floor(Math.random() * chars.length)])
    .join('');
```

```ts
const generateString = (length: number, chars: string) =>
  Array(length)
    .fill('')
    .map((v) => chars[Math.floor(Math.random() * chars.length)])
    .join('');
```

:::code-group-close

## Generate a random UUID

:::code-group-open

```js
const uuid = (a) =>
  a
    ? (a ^ ((Math.random() * 16) >> (a / 4))).toString(16)
    : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, uuid);
```

:::code-group-close
