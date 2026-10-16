const BARS = ".sf-chart-bar, .sf-budget-actual-bar, .sf-completion-bar, .sf-forecast-fill, .sf-evm-fill, .sf-team-evm-column-bar";
const RINGS = ".sf-donut-slice, .sf-exec-ring-segment";
const KPIS = "[data-portfolio-kpis] .sf-kpi-value";
const SELECTOR = `${BARS}, ${RINGS}, ${KPIS}`;

export function initVisualizationMotion(root) {
  if (!root || !window.IntersectionObserver || !Element.prototype.animate) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const seen = new WeakSet();
  const pending = new Set();
  const animations = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      pending.delete(target);
      if (seen.has(target)) continue;
      seen.add(target);
      if (reducedMotion.matches) continue;
      let frames;
      if (target.matches(RINGS)) {
        const dash = target.getAttribute("stroke-dasharray");
        const radius = Number(target.getAttribute("r"));
        if (!dash || !radius) continue;
        frames = [{ strokeDasharray: `0 ${2 * Math.PI * radius}` }, { strokeDasharray: dash }];
      } else if (target.matches(KPIS)) {
        // Keep exact values readable throughout; only the entrance is animated.
        frames = [{ opacity: 0.5, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }];
      } else {
        const column = target.matches(".sf-team-evm-column-bar");
        const origin = column ? "center bottom" : "left center";
        frames = [{ transform: column ? "scaleY(0)" : "scaleX(0)", transformOrigin: origin }, { transform: "scale(1)", transformOrigin: origin }];
      }
      const animation = target.animate(frames, { duration: 550, easing: "cubic-bezier(0.2, 0.65, 0.3, 1)" });
      animations.add(animation);
      animation.finished.catch(() => {}).finally(() => animations.delete(animation));
    }
  }, { threshold: 0.15 });
  let queued = false;
  const scan = () => {
    queued = false;
    for (const target of pending) {
      if (!target.isConnected) { observer.unobserve(target); pending.delete(target); }
    }
    root.querySelectorAll(SELECTOR).forEach((target) => {
      if (target.matches(KPIS) && !/\d/.test(target.textContent)) return;
      if (!seen.has(target) && !pending.has(target)) {
        pending.add(target);
        observer.observe(target);
      }
    });
  };
  new MutationObserver(() => {
    if (!queued) { queued = true; requestAnimationFrame(scan); }
  }).observe(root, { childList: true, subtree: true });
  const finish = () => { animations.forEach((animation) => animation.cancel()); animations.clear(); };
  reducedMotion.addEventListener("change", () => { if (reducedMotion.matches) finish(); });
  window.addEventListener("beforeprint", finish);
  scan();
}
