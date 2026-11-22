import { call } from "../api.js";
import { action, field, h, lines, notice, select } from "../ui.js";

export default {
  id: "settings",
  title: "Settings",
  async render({ reload }) {
    const box = h("div", {});
    try {
      const audit = await call("GET /v1/audit/settings");
      const days = h("input", {
        type: "number",
        min: 30,
        max: 3650,
        value: String(audit.retentionDays),
      });
      const mode = select(
        [
          ["off", "Off"],
          ["file", "A file on this machine"],
          ["webhook", "A webhook"],
        ],
        audit.siem.mode,
      );
      const hook = h("input", {
        type: "text",
        value: audit.siem.webhookUrl ?? "",
        placeholder: "http://127.0.0.1:9000/audit",
      });
      box.append(
        h(
          "section",
          {},
          h("h3", {}, "Audit log"),
          h(
            "div",
            { class: "row" },
            field("Keep entries for (days)", days),
            field("Stream to", mode),
            field("Webhook address", hook),
            action(
              "Save",
              () =>
                call("PUT /v1/audit/settings", {
                  body: {
                    retentionDays: Number(days.value),
                    siemMode: mode.value,
                    siemWebhookUrl: hook.value,
                  },
                }).then(reload),
              { kind: "act" },
            ),
            action("Send what failed again", () =>
              call("POST /v1/audit/siem/retry", { body: {} }).then(reload),
            ),
          ),
          h(
            "p",
            { class: "muted" },
            `Waiting: ${audit.siem.pending}. Sent: ${audit.siem.sent}. Failed: ${audit.siem.failed}.`,
          ),
          audit.siem.failures?.length
            ? h(
                "pre",
                { class: "mono" },
                audit.siem.failures.map((f) => JSON.stringify(f)).join("\n"),
              )
            : null,
        ),
      );
    } catch (error) {
      box.append(h("section", {}, h("h3", {}, "Audit log"), notice(error.message)));
    }
    try {
      const allow = await call("GET /v1/network/allowlist");
      const ranges = h("textarea", { "aria-label": "Allowed addresses" });
      ranges.value = allow.ranges.join("\n");
      box.append(
        h(
          "section",
          {},
          h("h3", {}, "Addresses that may reach this server"),
          h("p", { class: "muted" }, allow.note),
          ranges,
          action(
            "Save",
            () =>
              call("PUT /v1/network/allowlist", { body: { ranges: lines(ranges.value) } }).then(
                reload,
              ),
            { kind: "act" },
          ),
        ),
      );
    } catch (error) {
      box.append(h("section", {}, h("h3", {}, "Allowed addresses"), notice(error.message)));
    }
    box.append(
      h(
        "section",
        {},
        h("h3", {}, "About this console"),
        h(
          "p",
          { class: "muted" },
          "Every change here is a call to the server's API; the console has no access to the database. Its session is an HttpOnly cookie.",
        ),
      ),
    );
    return box;
  },
};
