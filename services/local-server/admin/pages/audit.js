import { call } from "../api.js";
import { action, download, field, h, notice, table, when } from "../ui.js";

export default {
  id: "audit",
  title: "Audit log",
  async render() {
    const actionFilter = h("input", { type: "text", placeholder: "such as auth.sign_in" });
    const holder = h("div", {});
    const verdict = h("div", {});
    const show = async (before) => {
      const answer = await call("GET /v1/audit", {
        query: { limit: 50, action: actionFilter.value, before },
      });
      const events = answer.events ?? [];
      holder.replaceChildren(
        table(
          ["#", "When", "Who", "What", "About", "Details"],
          events.map((event) => [
            String(event.seq),
            when(event.ts),
            event.actorId ?? "",
            event.action,
            [event.targetType, event.targetId].filter(Boolean).join(" "),
            h("code", {}, JSON.stringify(event.detail ?? {})),
          ]),
          "No entries match.",
        ),
        events.length === 50
          ? action("Older entries", () => show(events[events.length - 1].seq))
          : null,
      );
    };
    await show();
    return h(
      "div",
      {},
      h(
        "section",
        {},
        h(
          "div",
          { class: "row" },
          field("Kind of entry", actionFilter),
          action("Filter", () => show()),
          action("Check the chain", async () => {
            const result = await call("POST /v1/audit/verify", { body: {} });
            verdict.replaceChildren(
              result.ok
                ? notice(`The chain is intact (${result.count} entries).`, "good")
                : notice(`The chain breaks at entry ${result.badSeq ?? result.seq ?? "?"}.`, "bad"),
            );
          }),
          action("Download as JSON lines", async () =>
            download(
              "murmur-audit.jsonl",
              await call("GET /v1/audit/export", { query: { action: actionFilter.value } }),
              "application/x-ndjson",
            ),
          ),
        ),
        verdict,
        h(
          "p",
          { class: "muted" },
          "Each entry holds the hash of the one before it. Entries never hold dictated text, audio, notes or secrets.",
        ),
      ),
      h("section", {}, holder),
    );
  },
};
