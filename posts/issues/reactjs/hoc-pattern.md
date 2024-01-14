---
sidebar_position: 1
title: Higher-Order Components
comment: true
tags:
  - Reactjs
date: '2023-05-05'
author: hunghg255
---

# Higher-Order Components

Pass reusable logic down as props to components throughout your application

---

### Overview

Higher-Order Components (HOC) make it easy to pass logic to components by wrapping them.

For example, if we wanted to easily change the styles of a text by making the font larger and the font weight bolder, we could create two Higher-Order Components:

- `withLargeFontSize`, which appends the `font-size: "90px"` field to the `style` attribute.
- `withBoldFontWeight`, which appends the `font-weight: "bold"` field to the `style` attribute.

<video
  width='100%'
  height='430'
  autoPlay
  muted
  loop
  src='https://res.cloudinary.com/hunghg255/video/upload/v1677958186/blog/hoc_cy2dfl.mov'
  frameborder='0'
  allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
  allowFullScreen
  controls
/>

Any component that's wrapped with either of these higher-order components will get a larger font size, a bolder font weight, or both!

---

### Implementation

We can apply logic to another component, by:

1. Receiving another component as its `props`
2. Applying additional logic to the passed component
3. Returning the same or a new component with additional logic

![HOC](https://res.cloudinary.com/hunghg255/image/upload/v1677958190/blog/1_irw6pw.png)

To implement the above example, we can create a `withStyles` HOC that adds a `color` and `font-size` prop to the component's style.

```jsx
function withStyles(Component) {
  return (props) => {
    const style = {
      color: 'red',
      fontSize: '1em',
      // Merge props
      ...props.style,
    };

    return <Component {...props} style={style} />;
  };
}

const Text = ({ style }) => <p style={style}>Higher Order Component</p>;
const StyledText = withStyles(Text);
```

[Stackblitz](https://stackblitz.com/edit/react-ts-zuyzjj)

> [!NOTE]
> If you have a component that always needs to be wrapped within a HOC, you can also directly pass it instead of creating two separate components like we did in the example above.

```js
const Text = withStyles(() => <p style={{ fontFamily: 'Inter' }}>Hello world!</p>);
```
