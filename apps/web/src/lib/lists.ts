/** The items with the text typed added, unless it's blank or already there. */
export function withTyped(items: string[], text: string): string[] {
  const item = text.trim();
  return item === '' || items.includes(item) ? items : [...items, item];
}
