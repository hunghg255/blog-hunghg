---
title: 'Markdown Content'
date: '2020-01-01'
---

```ts twoslash title=blog.ts
import MarkdownIt from 'markdown-it';

console.log(1);
console.log(2);
//      ^?
```

```ts twoslash title=blog.ts
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

:::code-group-open

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

:::code-group-close

:::code-group-open

```js
const a = 2;
```

```ts
const a: number = 2;
```

:::code-group-close

- Block space

```ts
function block() {
  space();
  if (true) {
    table();
  }
}
```

- Word highlight

```ts twoslash
const obj = {
  boo: 1,
  bar: () => 2,
  baz: 'string',
};
obj.boo;
//   ^|
```

```ts twoslash
import { getHighlighterCore } from '@shikijs/core';

const highlighter = await getHighlighterCore({});

// @errors: 2322 2588
const str: string = 1;
str = 'Hello';
```

```ts twoslash
// @log: Custom log message
const a = 1;
// @error: Custom error message
const b = 1;
// @warn: Custom warning message
const c = 1;
// @annotate: Custom annotation message
const d = 1;
```

```ts twoslash
Number.parseInt('123', 10);
//      ^|
```

- Block space

```ts
function block() {
  space();
  if (true) {
    table();
  }
}
```

- Word highlight

```ts
export function foo() {
  // [!code word:Hello]
  const msg = 'Hello World';
  console.log(msg); // prints Hello World
}
```

```ts
// [!code word:options:2]
const options = { foo: 'bar' };
options.foo = 'baz';
console.log(options.foo); // this one will not be highlighted
```

## Mention

- {@hunghg255}

- {@namnh240795}
