import { call } from "../api.js";
import { action, check, field, h, notice, select, table, when } from "../ui.js";

export default {
  id: "invites",
  title: "Invites and requests",
  async render({ team, reload }) {
    if (!team) return notice("Make a team on the Teams page first.");
    const params = { teamId: team.id };
    const [invites, requests] = await Promise.all([
      call("GET /v1/teams/:teamId/invites", { params }),
      call("GET /v1/teams/:teamId/requests", { params }),
    ]);
    const fresh = h("div", {});
    const role = select(["member", "viewer", "manager", "admin"], "member");
    const days = h("input", { type: "number", min: 1, max: 90, value: "7" });
    const uses = h("input", { type: "number", min: 1, max: 1000, value: "1" });
    let approval = true;
    return h(
      "div",
      {},
      h(
        "section",
        {},
        h("h3", {}, "Make an invite"),
        h(
          "div",
          { class: "row" },
          field("Role", role),
          field("Valid for (days)", days),
          field("Uses", uses),
          check("An admin approves each join", true, (on) => (approval = on)),
          action(
            "Make the invite",
            async () => {
              const made = await call("POST /v1/teams/:teamId/invites", {
                params,
                body: {
                  role: role.value,
                  expiresInDays: Number(days.value),
                  maxUses: Number(uses.value),
                  approvalRequired: approval,
                },
              });
              // The code is shown now and never again; the server keeps only its hash.
              fresh.replaceChildren(
                notice("Copy this now. The code is shown once and cannot be shown again.", "good"),
                h("p", {}, h("strong", {}, "Code: "), h("code", {}, made.code)),
                h("p", {}, h("strong", {}, "Link: "), h("code", {}, made.link)),
              );
            },
            { kind: "act" },
          ),
        ),
        fresh,
      ),
      h(
        "section",
        {},
        h("h3", {}, "Invites"),
        table(
          ["Role", "State", "Uses", "Expires", "Approval", ""],
          invites.invites.map((invite) => [
            invite.role,
            invite.state,
            `${invite.uses} of ${invite.maxUses}`,
            when(invite.expiresAt),
            invite.approvalRequired ? "Needed" : "Not needed",
            invite.state === "active"
              ? action(
                  "Revoke",
                  () =>
                    call("DELETE /v1/teams/:teamId/invites/:inviteId", {
                      params: { ...params, inviteId: invite.id },
                    }).then(reload),
                  { kind: "danger", confirm: "Revoke this invite?" },
                )
              : "",
          ]),
        ),
      ),
      h(
        "section",
        {},
        h("h3", {}, "Requests to join"),
        table(
          ["Name", "Email", "Asked", "State", ""],
          requests.requests.map((request) => [
            request.name,
            request.email,
            when(request.createdAt),
            request.status,
            request.status !== "pending"
              ? ""
              : h(
                  "span",
                  { class: "row" },
                  action(
                    "Approve",
                    () =>
                      call("POST /v1/teams/:teamId/requests/:requestId/approve", {
                        params: { ...params, requestId: request.id },
                      }).then(reload),
                    { kind: "act" },
                  ),
                  action("Reject", () =>
                    call("POST /v1/teams/:teamId/requests/:requestId/reject", {
                      params: { ...params, requestId: request.id },
                    }).then(reload),
                  ),
                ),
          ]),
          "No one is waiting.",
        ),
      ),
    );
  },
};
