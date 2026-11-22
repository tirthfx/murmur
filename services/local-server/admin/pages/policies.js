import { call } from "../api.js";
import { action, check, field, h, lines, notice, select } from "../ui.js";

const FEATURES = [
  ["notetaker", "Notetaker"],
  ["scratchpad", "Scratchpad"],
  ["transforms", "Rewrites"],
  ["connectors", "Connectors"],
  ["shareLinksTeam", "Share links inside the team"],
  ["shareLinksAnyone", "Share links for anyone"],
  ["exportToFile", "Export to a file"],
  ["mcp", "The MCP server"],
  ["skillSharing", "Sharing Skills"],
];

export default {
  id: "policies",
  title: "Policies",
  async render({ team }) {
    if (!team) return notice("Make a team on the Teams page first.");
    const base = { teamId: team.id };
    const { departments } = await call("GET /v1/teams/:teamId/departments", { params: base }).catch(
      () => ({ departments: [] }),
    );
    const scopeSelect = select(
      [
        ["team", "The whole team"],
        ...departments.map((d) => [`department:${d.id}`, `Department ${d.name}`]),
      ],
      "team",
    );
    const holder = h("div", {});
    const show = async () => {
      const [scope, scopeId] = scopeSelect.value.split(":");
      const query = { scope, scopeId };
      const layer = await call("GET /v1/teams/:teamId/policy", { params: base, query });
      const values = layer.values ?? {};
      const effective = await call("GET /v1/teams/:teamId/policy/effective", { params: base });

      const on = new Map(FEATURES.map(([key]) => [key, values[`features.${key}`] !== false]));
      const apps = h("textarea", {
        "aria-label": "Blocked apps",
        placeholder: "com.example.app | Name",
      });
      apps.value = (values.blockedApps ?? [])
        .map((a) => `${a.bundleId}${a.name ? ` | ${a.name}` : ""}`)
        .join("\n");
      const domains = h("textarea", { "aria-label": "Blocked domains" });
      domains.value = (values.blockedDomains ?? []).join("\n");
      const connectors = h("textarea", { "aria-label": "Connectors turned off" });
      connectors.value = (values["connectors.disabled"] ?? []).join("\n");
      const appliesTo = select(
        [
          ["dictation", "Dictation only"],
          ["dictation_and_notetaker", "Dictation and Notetaker"],
        ],
        values["blockedApps.appliesTo"] ?? "dictation",
      );
      const num = (key) =>
        h("input", {
          type: "number",
          min: 1,
          max: 3650,
          value: values[key] == null ? "" : String(values[key]),
        });
      const retention = {
        "retention.audio.max": num("retention.audio.max"),
        "retention.audio.min": num("retention.audio.min"),
        "retention.transcript.max": num("retention.transcript.max"),
        "retention.transcript.min": num("retention.transcript.min"),
      };
      const contact = h("input", {
        type: "text",
        value: values.adminContact ?? "",
        maxlength: 200,
      });
      let readOnly = values["connectors.readOnly"] === true;
      let approval = values["deletion.requiresApproval"] === true;

      const save = async () => {
        const set = {};
        const unset = [];
        for (const [key] of FEATURES) {
          if (!on.get(key)) set[`features.${key}`] = false;
          else if (values[`features.${key}`] !== undefined) unset.push(`features.${key}`);
        }
        const listed = (key, parsed) =>
          parsed.length > 0 ? (set[key] = parsed) : values[key] !== undefined && unset.push(key);
        listed(
          "blockedApps",
          lines(apps.value).map((line) => {
            const [bundleId, ...name] = line.split("|");
            return { bundleId: bundleId.trim(), name: name.join("|").trim() };
          }),
        );
        listed("blockedDomains", lines(domains.value));
        listed("connectors.disabled", lines(connectors.value));
        if (appliesTo.value !== "dictation") set["blockedApps.appliesTo"] = appliesTo.value;
        else if (values["blockedApps.appliesTo"] !== undefined) unset.push("blockedApps.appliesTo");
        for (const [key, input] of Object.entries(retention)) {
          if (input.value !== "") set[key] = Number(input.value);
          else if (values[key] != null) unset.push(key);
        }
        for (const [key, value] of [
          ["connectors.readOnly", readOnly],
          ["deletion.requiresApproval", approval],
        ]) {
          if (value) set[key] = true;
          else if (values[key] !== undefined) unset.push(key);
        }
        if (contact.value.trim() !== "") set.adminContact = contact.value.trim();
        else if (values.adminContact) unset.push("adminContact");
        await call("PUT /v1/teams/:teamId/policy", {
          params: base,
          body: { scope, ...(scopeId ? { scopeId } : {}), set, unset },
        });
        await show();
      };

      holder.replaceChildren(
        h(
          "section",
          {},
          h("h3", {}, "Features"),
          h(
            "p",
            { class: "muted" },
            "A feature turned off here cannot be turned on again by a lower layer.",
          ),
          FEATURES.map(([key, name]) => check(name, on.get(key), (v) => on.set(key, v))),
        ),
        h(
          "section",
          {},
          h("h3", {}, "Blocked apps"),
          h("p", { class: "muted" }, "One per line: a bundle identifier, then | and a name."),
          apps,
          field("Applies to", appliesTo),
          h("h3", {}, "Blocked domains"),
          h("p", { class: "muted" }, "One per line. A domain also blocks its subdomains."),
          domains,
          h("h3", {}, "Connectors turned off"),
          h("p", { class: "muted" }, "One connector id per line, such as slack."),
          connectors,
        ),
        h(
          "section",
          {},
          h("h3", {}, "Retention (days, empty for no limit)"),
          h(
            "div",
            { class: "row" },
            field("Recordings: at most", retention["retention.audio.max"]),
            field("Recordings: at least", retention["retention.audio.min"]),
            field("Text and transcripts: at most", retention["retention.transcript.max"]),
            field("Text and transcripts: at least", retention["retention.transcript.min"]),
          ),
          check("Connectors may only read", readOnly, (v) => (readOnly = v)),
          check("Deleting recorded data needs approval", approval, (v) => (approval = v)),
          field("Whom to ask (shown next to a block)", contact),
          action("Save the policy", save, { kind: "act" }),
          notice("Retention, domains and connector limits need the Growth plan."),
        ),
        h(
          "section",
          {},
          h("h3", {}, "What members get now"),
          h("p", { class: "muted" }, "The strictest of the layers, as the app downloads it."),
          h("pre", { class: "mono" }, JSON.stringify(effective.policy, null, 2)),
        ),
      );
    };
    scopeSelect.addEventListener("change", () => void show());
    await show();
    return h("div", {}, h("section", {}, field("Settings for", scopeSelect)), holder);
  },
};
