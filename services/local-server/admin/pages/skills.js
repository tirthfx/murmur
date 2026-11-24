import { call } from "../api.js";
import { action, field, h, notice, select, table, when } from "../ui.js";

/** Skills a team publishes, and the folders of shared notes (NT-16, NT-17). */
export default {
  id: "skills",
  title: "Skills and folders",
  async render({ team, reload }) {
    if (!team) return notice("Make a team on the Teams page first.");
    const params = { teamId: team.id };
    const [skillList, folderList, departmentList] = await Promise.all([
      call("GET /v1/teams/:teamId/skills", { params }),
      call("GET /v1/teams/:teamId/folders", { params }),
      call("GET /v1/teams/:teamId/departments", { params }).catch(() => ({ departments: [] })),
    ]);
    const departments = departmentList.departments;
    const departmentName = (id) => departments.find((d) => d.id === id)?.name ?? "";
    const places = [
      ["company", "The whole team"],
      ...departments.map((d) => [`department:${d.id}`, `Department: ${d.name}`]),
    ];
    const split = (value) =>
      value.startsWith("department:")
        ? { scope: "department", departmentId: value.slice("department:".length) }
        : { scope: "company" };

    // ---- Skills ----
    const name = h("input", { type: "text", maxlength: 100 });
    const description = h("input", { type: "text", maxlength: 500 });
    const body = h("textarea", {
      rows: 8,
      "aria-label": "The Skill file (front matter, then the prompt)",
    });
    const place = select(places, "company");
    const skills = h(
      "section",
      {},
      h("h3", {}, "Skills"),
      h(
        "p",
        { class: "muted" },
        "Members read a published Skill and can copy it into their own; only admins (and a department's manager, for that department) change it. A change makes a new version.",
      ),
      table(
        ["Name", "For", "Version", "Changed", "", ""],
        skillList.skills.map((skill) => [
          skill.name,
          skill.scope === "company" ? "The whole team" : departmentName(skill.departmentId),
          `v${skill.version}`,
          when(skill.updatedAt),
          action("Edit the prompt", async () => {
            const text = window.prompt("The Skill file", skill.body);
            if (text === null) return;
            await call("PATCH /v1/teams/:teamId/skills/:id", {
              params: { ...params, id: skill.id },
              body: { body: text },
            });
            await reload();
          }),
          action(
            "Remove",
            () =>
              call("DELETE /v1/teams/:teamId/skills/:id", {
                params: { ...params, id: skill.id },
              }).then(reload),
            { kind: "danger", confirm: `Remove the Skill ${skill.name} for everyone?` },
          ),
        ]),
        "No Skill is published yet.",
      ),
      h("h3", {}, "Publish a Skill"),
      h(
        "div",
        { class: "row" },
        field("Name", name),
        field("What it does", description),
        field("For", place),
      ),
      field("The Skill file", body),
      action(
        "Publish",
        async () => {
          await call("POST /v1/teams/:teamId/skills", {
            params,
            body: {
              name: name.value,
              description: description.value,
              body: body.value,
              ...split(place.value),
            },
          });
          await reload();
        },
        { kind: "act" },
      ),
    );

    // ---- folders ----
    const folderName = h("input", { type: "text", maxlength: 100 });
    const folderKind = select(
      [
        ["company", "The whole team"],
        ...departments.map((d) => [`department:${d.id}`, `Department: ${d.name}`]),
      ],
      "company",
    );
    const folders = h(
      "section",
      {},
      h("h3", {}, "Shared folders"),
      h(
        "p",
        { class: "muted" },
        "Folders hold copies of notes that people chose to share, as text. Audio is never shared. A person's own shared folders (named people) are made from the app; here are the department and company ones, and all of them can be removed.",
      ),
      table(
        ["Name", "Kind", "People", "Notes", ""],
        folderList.folders.map((folder) => [
          folder.name,
          folder.kind === "department"
            ? `Department: ${departmentName(folder.departmentId)}`
            : folder.kind === "company"
              ? "The whole team"
              : "Named people",
          folder.kind === "shared" ? String(folder.members.length) : "",
          String(folder.items.length),
          action(
            "Remove",
            () =>
              call("DELETE /v1/teams/:teamId/folders/:id", {
                params: { ...params, id: folder.id },
              }).then(reload),
            {
              kind: "danger",
              confirm: `Remove the folder ${folder.name} and the ${folder.items.length} notes in it?`,
            },
          ),
        ]),
        "No folder yet.",
      ),
      h("h3", {}, "Make a folder"),
      h(
        "div",
        { class: "row" },
        field("Name", folderName),
        field("For", folderKind),
        action(
          "Make the folder",
          async () => {
            const target = split(folderKind.value);
            await call("POST /v1/teams/:teamId/folders", {
              params,
              body: {
                name: folderName.value,
                kind: target.scope,
                ...(target.departmentId ? { departmentId: target.departmentId } : {}),
              },
            });
            await reload();
          },
          { kind: "act" },
        ),
      ),
    );
    return h("div", {}, skills, folders);
  },
};
