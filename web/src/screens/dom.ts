/** Tiny element builder. Text is always set as text, never parsed as HTML. */
export type Child = Node | string | null | false | undefined;

export interface Props {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
  onClick?: () => void;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.className) element.className = props.className;
  if (props.text !== undefined) element.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) element.setAttribute(name, value);
  if (props.onClick) element.addEventListener('click', props.onClick);
  for (const child of children) {
    if (child === null || child === false || child === undefined) continue;
    element.append(child);
  }
  return element;
}
