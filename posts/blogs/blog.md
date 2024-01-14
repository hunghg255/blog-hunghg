---
title: 'Markdown Content'
date: '2020-01-01'
---

```ts twoslash title=blog.ts
console.log(1);
console.log(2);
//     ^?

import { rendererRich, transformerTwoSlash } from 'shikiji-twoslash';

transformerTwoSlash({
  renderer: rendererRich(), // <--
});

import { codeToHtml } from 'shikiji';
import {
  transformerNotationDiff,
  // ...
} from 'shikiji-transformers';

const code = `console.log('hello')`;
const html = await codeToHtml(code, {
  lang: 'ts',
  theme: 'nord',
  transformers: [
    transformerNotationDiff(),
    // ...
  ],
});
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
