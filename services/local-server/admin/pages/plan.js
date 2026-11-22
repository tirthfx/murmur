import { call } from "../api.js";
import { action, h, notice, select, table } from "../ui.js";

const TIERS = [
  ["free", "Free"],
  ["pro", "Pro"],
  ["team", "Team"],
  ["growth", "Growth"],
  ["enterprise", "Enterprise"],
];

export default {
  id: "plan",
  title: "Plan and compliance",
  async render({ team, reload }) {
    const plan = await call("GET /v1/plan");
    const tier = select(TIERS, plan.tier);
    const box = h(
      "div",
      {},
      h(
        "section",
        {},
        h("h3", {}, `Plan: ${plan.label}`),
        notice(plan.note),
        h(
          "div",
          { class: "row" },
          tier,
          action(
            "Change the plan",
            () => call("PUT /v1/plan", { body: { tier: tier.value } }).then(reload),
            { kind: "act" },
          ),
        ),
        h("p", { class: "muted" }, plan.training.notice),
        table(
          ["Feature", "From", "On this plan"],
          plan.features.map((feature) => [
            feature.name,
            feature.availableFrom,
            feature.allowed ? "Yes" : "No",
          ]),
        ),
      ),
    );
    if (team) {
      const params = { teamId: team.id };
      try {
        const compliance = await call("GET /v1/teams/:teamId/compliance", { params });
        const mode = select(
          [["none", "None"], ...compliance.bundles.map((bundle) => [bundle.id, bundle.title])],
          compliance.mode,
        );
        box.append(
          h(
            "section",
            {},
            h("h3", {}, "Compliance mode"),
            notice(compliance.notice),
            h(
              "div",
              { class: "row" },
              mode,
              action(
                "Save",
                () =>
                  call("PUT /v1/teams/:teamId/compliance", {
                    params,
                    body: { mode: mode.value },
                  }).then(reload),
                { kind: "act" },
              ),
            ),
            table(
              ["Bundle", "Sets"],
              compliance.bundles.map((bundle) => [bundle.title, bundle.sets.join(", ")]),
            ),
          ),
        );
      } catch (error) {
        box.append(h("section", {}, h("h3", {}, "Compliance mode"), notice(error.message)));
      }
    }
    return box;
  },
};
