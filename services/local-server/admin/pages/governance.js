import { call } from "../api.js";
import { action, check, field, h, notice, select, table } from "../ui.js";

const label = (item) =>
  item.kind === "dictionary"
    ? `${item.payload.term}${item.payload.replacement ? ` -> ${item.payload.replacement}` : ""}`
    : `${item.payload.trigger} -> ${item.payload.expansion ?? ""}`;

export default {
  id: "governance",
  title: "Dictionary and Snippets",
  async render({ team, reload }) {
    if (!team) return notice("Make a team on the Teams page first.");
    const params = { teamId: team.id };
    const [settings, pending, dictionary, snippets, conflicts] = await Promise.all([
      call("GET /v1/teams/:teamId/vocabulary/settings", { params }),
      call("GET /v1/teams/:teamId/vocabulary/pending", { params }).catch(() => ({ items: [] })),
      call("GET /v1/teams/:teamId/dictionary", { params }),
      call("GET /v1/teams/:teamId/snippets", { params }),
      call("GET /v1/teams/:teamId/vocabulary/conflicts", { params }).catch(() => ({
        terms: [],
        snippetTriggers: [],
      })),
    ]);

    const mode = select(
      [
        ["open", "Open: changes go live at once"],
        ["review", "Review: a person decides each change"],
        ["locked", "Locked: only admins change entries"],
      ],
      settings.governanceMode,
    );
    const days = h("input", {
      type: "number",
      min: 1,
      max: 3650,
      value: String(settings.rollbackRetentionDays),
    });
    let rich = settings.allowRichText;

    const item = (entry) => [
      entry.kind,
      label(entry),
      entry.scope,
      entry.locked ? "Locked" : "",
      h(
        "span",
        { class: "row" },
        action(entry.locked ? "Unlock" : "Lock", () =>
          call("POST /v1/teams/:teamId/vocabulary/items/:itemId/lock", {
            params: { ...params, itemId: entry.id },
            body: { locked: !entry.locked },
          }).then(reload),
        ),
        action(
          "Delete",
          () =>
            call("DELETE /v1/teams/:teamId/vocabulary/items/:itemId", {
              params: { ...params, itemId: entry.id },
            }).then(reload),
          { kind: "danger", confirm: "Delete this entry?" },
        ),
      ),
    ];

    const csv = h("textarea", { placeholder: "term,replacement,scope" });
    const preview = h("div", {});
    const runImport = async (confirm) => {
      const result = await call("POST /v1/teams/:teamId/dictionary/import", {
        params,
        body: { csv: csv.value, confirm },
      });
      const duplicates = Array.isArray(result.duplicates)
        ? result.duplicates.length
        : result.duplicates;
      const errors = Array.isArray(result.errors) ? result.errors.length : result.errors;
      preview.replaceChildren(
        notice(
          confirm
            ? `Imported ${result.imported} entries. Skipped ${duplicates} duplicates and ${errors} rows with errors.`
            : `This would add ${result.wouldImport.length} entries, skip ${duplicates} duplicates and refuse ${errors} rows with errors.`,
          errors > 0 ? "bad" : "good",
        ),
      );
      if (confirm) await reload();
    };

    return h(
      "div",
      {},
      h(
        "section",
        {},
        h("h3", {}, "Governance"),
        h(
          "div",
          { class: "row" },
          field("Who decides", mode),
          field("Keep versions for (days)", days),
          check("Rich text in snippets", rich, (on) => (rich = on)),
          action(
            "Save",
            () =>
              call("PUT /v1/teams/:teamId/vocabulary/settings", {
                params,
                body: {
                  governanceMode: mode.value,
                  rollbackRetentionDays: Number(days.value),
                  allowRichText: rich,
                },
              }).then(reload),
            { kind: "act" },
          ),
        ),
      ),
      h(
        "section",
        {},
        h("h3", {}, "Waiting for a decision"),
        table(
          ["Kind", "Entry", "Proposed by", ""],
          pending.items.map((entry) => {
            const why = h("input", { type: "text", placeholder: "Why not (shown to them)" });
            return [
              entry.kind,
              label(entry),
              entry.proposedBy,
              h(
                "span",
                { class: "row" },
                action(
                  "Approve",
                  () =>
                    call("POST /v1/teams/:teamId/vocabulary/items/:itemId/approve", {
                      params: { ...params, itemId: entry.id },
                      body: {},
                    }).then(reload),
                  { kind: "act" },
                ),
                why,
                action("Reject", () =>
                  call("POST /v1/teams/:teamId/vocabulary/items/:itemId/reject", {
                    params: { ...params, itemId: entry.id },
                    body: { comment: why.value },
                  }).then(reload),
                ),
              ),
            ];
          }),
          "Nothing is waiting.",
        ),
      ),
      h(
        "section",
        {},
        h("h3", {}, "Shared entries"),
        table(
          ["Kind", "Entry", "Scope", "", ""],
          [...dictionary.items, ...snippets.items].map(item),
          "No shared entries yet.",
        ),
      ),
      h(
        "section",
        {},
        h("h3", {}, "Conflicts"),
        conflicts.terms.length + conflicts.snippetTriggers.length === 0
          ? h("p", { class: "muted" }, "No conflicts.")
          : h(
              "ul",
              {},
              [...conflicts.terms, ...conflicts.snippetTriggers].map((entry) =>
                h("li", {}, typeof entry === "string" ? entry : JSON.stringify(entry)),
              ),
            ),
      ),
      h(
        "section",
        {},
        h("h3", {}, "Import dictionary entries from CSV"),
        csv,
        h(
          "div",
          { class: "row" },
          action("Check the file", () => runImport(false)),
          action("Import", () => runImport(true), { kind: "act" }),
        ),
        preview,
      ),
      h(
        "section",
        {},
        h("h3", {}, "Skills"),
        notice("Shared Skills are not built yet: they need the team content of the Notetaker."),
      ),
    );
  },
};
