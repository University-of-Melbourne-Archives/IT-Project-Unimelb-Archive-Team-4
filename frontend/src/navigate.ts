import type { MouseEvent } from "react";

// Follows a link to another of the app's screens without loading the page again: the address changes and the app shows that
// screen (App re-reads the address on popstate) from its top, with the focus on its heading when the link clicked went with the
// screen before, as loading the page would. A click meant for a new tab or window is left to the browser; one on a link to the
// screen shown does nothing.
export function navigate(e: MouseEvent<HTMLAnchorElement>) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const link = e.currentTarget;
  if (link.href === location.href) return;
  history.pushState(null, "", link.href);
  window.scrollTo(0, 0);
  window.dispatchEvent(new PopStateEvent("popstate"));
  requestAnimationFrame(() => {
    const heading = document.querySelector<HTMLElement>("h1");
    if (link.isConnected || !heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
}
