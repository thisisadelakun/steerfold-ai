// Native modal dialogs provide focus containment and background inertness.
export function createUtilityDialog(title, className) {
  if (document.querySelector(".sf-utility-dialog[open], .sf-tour-overlay")) return null;
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = `sf-utility-dialog ${className}`;
  dialog.setAttribute("aria-labelledby", "sf-utility-title");
  const header = document.createElement("header");
  header.className = "sf-utility-header";
  const heading = document.createElement("h2");
  heading.id = "sf-utility-title";
  heading.textContent = title;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "sf-utility-close";
  close.setAttribute("aria-label", "Close dialog");
  close.title = "Close dialog";
  close.textContent = "\u00d7";
  close.addEventListener("click", () => dialog.close());
  header.append(heading, close);
  dialog.append(header);
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }, { once: true });
  return {
    dialog,
    open() {
      document.body.append(dialog);
      dialog.showModal();
    },
  };
}
