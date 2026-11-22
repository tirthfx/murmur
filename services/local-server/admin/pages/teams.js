import { call } from "../api.js";
import { action, field, h, notice, select, table } from "../ui.js";

export default {
  id: "teams",
  title: "Teams and departments",
  async render({ team, teams, reload, refreshTeams }) {
    const name = h("input", { type: "text", maxlength: 100 });
    const box = h(
      "div",
      {},
      h(
        "section",
        {},
        h("h3", {}, "Teams"),
        table(
          ["Name", "Your role", "Members"],
          teams.map((entry) => [entry.name, entry.myRole, String(entry.memberCount)]),
          "No team yet.",
        ),
        h(
          "div",
          { class: "row" },
          field("New team", name),
          action(
            "Make the team",
            async () => {
              await call("POST /v1/teams", { body: { name: name.value } });
              await refreshTeams();
            },
            { kind: "act" },
          ),
        ),
      ),
    );
    if (!team) return box;

    const params = { teamId: team.id };
    const rename = h("input", { type: "text", value: team.name, maxlength: 100 });
    box.append(
      h(
        "section",
        {},
        h("h3", {}, `The team ${team.name}`),
        h(
          "div",
          { class: "row" },
          field("Name", rename),
          action("Rename", async () => {
            await call("PATCH /v1/teams/:teamId", { params, body: { name: rename.value } });
            await refreshTeams();
          }),
          action(
            "Delete the team",
            async () => {
              await call("DELETE /v1/teams/:teamId", { params });
              await refreshTeams();
            },
            { kind: "danger", confirm: `Delete ${team.name} and everything shared in it?` },
          ),
        ),
      ),
    );

    const { departments } = await call("GET /v1/teams/:teamId/departments", { params });
    const dName = h("input", { type: "text", maxlength: 100 });
    const dCost = h("input", { type: "text", maxlength: 50 });
    const dParent = select(
      [["", "None"], ...departments.filter((d) => !d.parentId).map((d) => [d.id, d.name])],
      "",
    );
    box.append(
      h(
        "section",
        {},
        h("h3", {}, "Departments and cost centers"),
        table(
          ["Name", "Cost center", "Inside", ""],
          departments.map((department) => {
            const costCenter = h("input", { type: "text", value: department.costCenter ?? "" });
            return [
              department.name,
              costCenter,
              departments.find((d) => d.id === department.parentId)?.name ?? "",
              h(
                "span",
                { class: "row" },
                action("Save cost center", () =>
                  call("PATCH /v1/teams/:teamId/departments/:departmentId", {
                    params: { ...params, departmentId: department.id },
                    body: { costCenter: costCenter.value },
                  }).then(reload),
                ),
                action(
                  "Delete",
                  () =>
                    call("DELETE /v1/teams/:teamId/departments/:departmentId", {
                      params: { ...params, departmentId: department.id },
                    }).then(reload),
                  {
                    kind: "danger",
                    confirm: `Delete ${department.name}? Its members keep no department.`,
                  },
                ),
              ),
            ];
          }),
          "No departments.",
        ),
        h(
          "div",
          { class: "row" },
          field("Name", dName),
          field("Cost center", dCost),
          field("Inside", dParent),
          action(
            "Add the department",
            () =>
              call("POST /v1/teams/:teamId/departments", {
                params,
                body: {
                  name: dName.value,
                  costCenter: dCost.value,
                  ...(dParent.value ? { parentId: dParent.value } : {}),
                },
              }).then(reload),
            { kind: "act" },
          ),
        ),
        notice("A department can be inside one other department, no deeper."),
      ),
    );
    return box;
  },
};
