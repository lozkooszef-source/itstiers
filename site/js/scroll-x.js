(() => {
  if (window.__itstiersWheelScroll) return;
  window.__itstiersWheelScroll = true;

  const selectors = [
    ".itstiers-horizontal-scroll",
    ".overall_player__slots-wrapper",
    ".profile-box_styles",
    "section.overflow-x-auto",
    ".overflow-x-auto",
  ].join(",");

  function canScrollX(element) {
    return element && element.scrollWidth > element.clientWidth + 2;
  }

  function findScrollTarget(start) {
    let node = start instanceof Element ? start : start?.parentElement;

    while (node && node !== document.body) {
      if (node.matches?.(selectors) && canScrollX(node)) return node;

      const style = window.getComputedStyle(node);
      if ((style.overflowX === "auto" || style.overflowX === "scroll") && canScrollX(node)) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  document.addEventListener(
    "wheel",
    (event) => {
      if (event.defaultPrevented || event.ctrlKey) return;

      const target = findScrollTarget(event.target);
      if (!target) return;

      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;

      const before = target.scrollLeft;
      const max = target.scrollWidth - target.clientWidth;
      const next = Math.max(0, Math.min(max, before + delta));

      if (next === before) return;

      target.scrollLeft = next;
      event.preventDefault();
    },
    { passive: false },
  );
})();
