---
title: 'Markdown Content'
date: '2020-01-01'
---

```ts twoslash title=blog.ts
console.log(1);
console.log(2);
//     ^?

import { rendererRich, transformerTwoslash } from '@shikijs/twoslash';

transformerTwoslash({
  renderer: rendererRich(), // <--
});

import {
  transformerNotationDiff,
  // ...
} from '@shikijs/transformers';

const code = `console.log('hello')`;
```

```js
console.log(1); // [!code ++]
console.log(1); // [!code --]
console.log(1); // [!code highlight]
console.log(1); // [!code error]
console.log(1); // [!code warning]
```

```js
console.log(1);
console.log(1); // [!code focus]
console.log(1);
```

# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6

::code-group-open

```bash [npm]
 npm install @nuxtjs/html-validator --save-dev
```

```bash [yarn]
 yarn add @nuxtjs/html-validator --dev
```

```bash [pnpm]
 pnpm i -D @nuxtjs/html-validator
```

```bash [bun]
 bun install @nuxtjs/html-validator --save-dev
```

::code-group-close

## Heading 2
