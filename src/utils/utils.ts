export function getTextExcept(element: any, exclude: any) {
  return worker(element);

  function worker(node: any, text = '') {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (exclude && !node.matches(exclude)) {
        for (const child of node.childNodes) {
          text = worker(child, text);
        }
      }
    }
    return text;
  }
}

export const copyContent = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    console.error('Failed to copy: ', err);
  }
};

export const stringToSlug = (str: string) => {
  return str
    .normalize('NFD') // Normalize the string to decompose combined characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .toLowerCase() // Convert the string to lowercase
    .replace(/đ/g, 'd') // Special case for Vietnamese đ character
    .replace(/[\s\W-]+/g, '-') // Replace spaces and non-word characters with dashes
    .replace(/^-+|-+$/g, ''); // Remove leading and trailing dashes
};
