/** Small DOM helpers. Text is always set as text, never as markup, so nothing stored can run. */
export function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "class") node.className = value;
    else if (key === "value" || key === "checked" || key === "disabled" || key === "selected")
      node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

export const when = (ms) => (ms ? new Date(ms).toLocaleString() : "");

export function notice(message, kind = "") {
  return h("div", { class: `notice ${kind}`, role: kind === "bad" ? "alert" : "status" }, message);
}

/** The label every identity screen carries: SSO, SCIM and domains are simulations (ADR-0091). */
export function simulationBanner(simulation) {
  return h(
    "div",
    { class: "notice simulation", role: "note", "data-simulation": "true" },
    h("strong", {}, `${simulation?.label ?? "Simulation"}. `),
    simulation?.notice ??
      "This is a simulation. It does not check anything with a real identity provider or a real DNS record.",
  );
}

export function field(label, input) {
  return h("label", { class: "field" }, h("span", {}, label), input);
}

export function check(label, checked, onChange) {
  const box = h("input", { type: "checkbox", checked: !!checked });
  if (onChange) box.addEventListener("change", () => onChange(box.checked));
  return h("label", { class: "check" }, box, label);
}

export function select(options, current, onChange) {
  const node = h(
    "select",
    {},
    options.map((option) => {
      const [value, label] = Array.isArray(option) ? option : [option, option];
      return h("option", { value, selected: value === current }, label);
    }),
  );
  if (onChange) node.addEventListener("change", () => onChange(node.value));
  return node;
}

export function table(headers, rows, empty = "Nothing here yet.") {
  if (rows.length === 0) return h("p", { class: "muted" }, empty);
  return h(
    "table",
    {},
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        headers.map((name) => h("th", { scope: "col" }, name)),
      ),
    ),
    h(
      "tbody",
      {},
      rows.map((cells) =>
        h(
          "tr",
          {},
          cells.map((cell) => h("td", {}, cell)),
        ),
      ),
    ),
  );
}

/** A button that runs an async action, shows its failure next to it and keeps one run at a time. */
export function action(label, run, { kind = "plain", confirm: ask } = {}) {
  const out = h("span", { class: "muted", role: "status" });
  const button = h("button", { type: "button", class: kind === "danger" ? "plain danger" : kind });
  button.textContent = label;
  button.addEventListener("click", async () => {
    if (ask && !window.confirm(ask)) return;
    button.disabled = true;
    out.textContent = "";
    try {
      await run();
    } catch (error) {
      out.textContent = error instanceof Error ? error.message : "That did not work.";
      out.className = "notice bad";
    } finally {
      button.disabled = false;
    }
  });
  return h("span", { class: "row" }, button, out);
}

/** Saves a text answer as a file the person asked for (an export). */
export function download(name, text, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = h("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const lines = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
