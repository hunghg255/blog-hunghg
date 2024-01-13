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
```

# Heading 1

## Heading 2

### Heading 3

#### Heading 4

##### Heading 5

###### Heading 6
