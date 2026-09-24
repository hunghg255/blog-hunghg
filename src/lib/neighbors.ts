type Item = { href: string; title: string };

/** Returns the posts around `href` in a newest-first list: prev is older, next is newer. */
export function getNeighbors(items: Item[], href: string) {
  const index = items.findIndex((item) => item.href === href);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: items[index + 1] ?? null,
    next: items[index - 1] ?? null,
  };
}
