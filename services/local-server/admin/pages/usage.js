import { call } from "../api.js";
import { action, check, download, field, h, notice, select, table } from "../ui.js";

const METRICS = [
  ["words", "Words"],
  ["dictations", "Dictations"],
  ["meetings_recorded", "Meetings"],
  ["meeting_minutes_recorded", "Meeting minutes"],
  ["skills_run", "Skills run"],
  ["ask_sessions", "Ask sessions"],
];

export default {
  id: "usage",
  title: "Usage",
  async render({ team }) {
    if (!team) return notice("Make a team on the Teams page first.");
    const params = { teamId: team.id };
    const { departments } = await call("GET /v1/teams/:teamId/departments", { params }).catch(
      () => ({
        departments: [],
      }),
    );
    const from = h("input", { type: "date" });
    const to = h("input", { type: "date" });
    const department = select([["", "Everyone"], ...departments.map((d) => [d.id, d.name])], "");
    const holder = h("div", {});
    const query = () => ({ from: from.value, to: to.value, department: department.value });

    const show = async () => {
      const report = await call("GET /v1/teams/:teamId/usage", { params, query: query() });
      from.value ||= report.range.from;
      to.value ||= report.range.to;
      holder.replaceChildren(
        h(
          "section",
          {},
          h("h3", {}, `${report.range.from} to ${report.range.to}`),
          h(
            "div",
            { class: "row" },
            Object.entries(report.totals).map(([key, value]) =>
              h(
                "div",
                { class: "field" },
                h("span", {}, key.replaceAll("_", " ")),
                h("strong", {}, String(value)),
              ),
            ),
          ),
          h(
            "p",
            { class: "muted" },
            `Time saved is estimated at ${report.typingWpm} typed words a minute.`,
          ),
          table(
            ["Day", ...METRICS.map(([, name]) => name)],
            report.daily
              .filter((day) => METRICS.some(([key]) => day[key] > 0))
              .map((day) => [day.day, ...METRICS.map(([key]) => String(day[key] ?? 0))]),
            "No usage in this range.",
          ),
        ),
        h(
          "section",
          {},
          h("h3", {}, "Export"),
          action("Download the rows as CSV", async () => {
            const text = await call("GET /v1/teams/:teamId/usage/export", {
              params,
              query: query(),
            });
            download("murmur-usage.csv", text, "text/csv");
          }),
        ),
      );
    };

    const board = await call("GET /v1/teams/:teamId/leaderboard", { params }).catch(() => null);
    const settings = await call("GET /v1/teams/:teamId/usage/settings", { params }).catch(
      () => null,
    );
    const extras = h("div", {});
    if (board?.settings) {
      let enabled = board.settings.enabled;
      let visible = board.settings.visibleByDefault;
      const metric = select(["words", "meetings", "streak"], board.settings.metric);
      extras.append(
        h(
          "section",
          {},
          h("h3", {}, "Leaderboard"),
          h(
            "div",
            { class: "row" },
            check("On", enabled, (v) => (enabled = v)),
            check("People are listed unless they opt out", visible, (v) => (visible = v)),
            field("Counts", metric),
            action(
              "Save",
              () =>
                call("PUT /v1/teams/:teamId/leaderboard/settings", {
                  params,
                  body: { enabled, visibleByDefault: visible, metric: metric.value },
                }),
              { kind: "act" },
            ),
          ),
        ),
      );
    }
    if (settings) {
      const wpm = h("input", {
        type: "number",
        min: 10,
        max: 200,
        value: String(settings.typingWpm),
      });
      const keep = h("input", {
        type: "number",
        min: 30,
        max: 3650,
        value: String(settings.retentionDays),
      });
      let names = settings.appNames;
      extras.append(
        h(
          "section",
          {},
          h("h3", {}, "Usage settings"),
          h(
            "div",
            { class: "row" },
            field("Typing speed for time saved (words a minute)", wpm),
            field("Keep usage for (days)", keep),
            check("Keep real app names", names, (v) => (names = v)),
            action(
              "Save",
              () =>
                call("PUT /v1/teams/:teamId/usage/settings", {
                  params,
                  body: {
                    typingWpm: Number(wpm.value),
                    retentionDays: Number(keep.value),
                    appNames: names,
                  },
                }),
              { kind: "act" },
            ),
          ),
        ),
      );
    }
    from.addEventListener("change", () => void show());
    to.addEventListener("change", () => void show());
    department.addEventListener("change", () => void show());
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
          field("From", from),
          field("To", to),
          field("Department", department),
        ),
      ),
      holder,
      extras,
    );
  },
};
