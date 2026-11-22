import { call } from "../api.js";
import { action, field, h, notice, select, table, when } from "../ui.js";

const ROLES = ["owner", "admin", "manager", "member", "viewer"];

export default {
  id: "members",
  title: "Members",
  async render({ team, reload }) {
    const box = h("div", {});
    if (team) {
      const [list, departments] = await Promise.all([
        call("GET /v1/teams/:teamId/members", { params: { teamId: team.id } }),
        call("GET /v1/teams/:teamId/departments", { params: { teamId: team.id } }).catch(() => ({
          departments: [],
        })),
      ]);
      const change = (userId, patch) =>
        call("PATCH /v1/teams/:teamId/members/:userId", {
          params: { teamId: team.id, userId },
          body: patch,
        }).then(reload);
      box.append(
        h(
          "section",
          {},
          h("h3", {}, `People in ${team.name}`),
          table(
            ["Name", "Email", "Role", "Department", "Joined", ""],
            list.members.map((member) => [
              member.name,
              member.email,
              select(
                ROLES,
                member.role,
                (role) => void change(member.userId, { role }).catch(alertError),
              ),
              select(
                [["", "None"], ...departments.departments.map((d) => [d.id, d.name])],
                member.departmentId ?? "",
                (id) =>
                  void change(member.userId, { departmentId: id === "" ? null : id }).catch(
                    alertError,
                  ),
              ),
              when(member.joinedAt),
              action(
                "Remove",
                () =>
                  call("DELETE /v1/teams/:teamId/members/:userId", {
                    params: { teamId: team.id, userId: member.userId },
                  }).then(reload),
                { kind: "danger", confirm: `Remove ${member.name} from ${team.name}?` },
              ),
            ]),
          ),
        ),
      );
    } else box.append(notice("Make a team on the Teams page first."));

    // Accounts on the server are the server owner's to list and add.
    try {
      const users = await call("GET /v1/users");
      const name = h("input", { type: "text", autocomplete: "off" });
      const email = h("input", { type: "email", autocomplete: "off" });
      const password = h("input", { type: "password", autocomplete: "new-password" });
      box.append(
        h(
          "section",
          {},
          h("h3", {}, "Accounts on this server"),
          table(
            ["Name", "Email", "Status", "Created"],
            users.users.map((user) => [user.name, user.email, user.status, when(user.createdAt)]),
          ),
          h("h3", {}, "Add an account"),
          h(
            "div",
            { class: "row" },
            field("Name", name),
            field("Email", email),
            field("Password (12 or more characters)", password),
            action(
              "Add the account",
              async () => {
                await call("POST /v1/users", {
                  body: { name: name.value, email: email.value, password: password.value },
                });
                password.value = "";
                await reload();
              },
              { kind: "act" },
            ),
          ),
        ),
      );
    } catch {
      // Not the server owner: the list is not for this person.
    }
    return box;
  },
};

function alertError(error) {
  window.alert(error instanceof Error ? error.message : "That did not work.");
}
