import { call } from "../api.js";
import { action, check, field, h, notice, select, simulationBanner, table, when } from "../ui.js";

export default {
  id: "identity",
  title: "Identity (simulation)",
  async render({ team, reload }) {
    if (!team) return notice("Make a team on the Teams page first.");
    const params = { teamId: team.id };
    const info = await call("GET /v1/teams/:teamId/identity", { params });
    const { domains } = await call("GET /v1/teams/:teamId/identity/domains", { params });
    const sso = info.sso;
    const scim = info.scim;

    // ---- SSO ----
    const xml = h("textarea", { "aria-label": "Identity provider metadata (XML)" });
    let flags = { enabled: sso.enabled, jitCreate: sso.jitCreate, enforce: sso.enforce };
    const testOut = h("div", {});
    const ssoSection = h(
      "section",
      {},
      simulationBanner(sso.simulation),
      h("h3", {}, "Single sign-on"),
      h(
        "p",
        { class: "muted" },
        `Entity id: ${sso.sp.entityId}. Reply address: ${sso.sp.acsUrl}. ${sso.configured ? `Provider: ${sso.idp?.entityId ?? "set"}.` : "No provider metadata yet."}`,
      ),
      xml,
      h(
        "div",
        { class: "row" },
        check("Single sign-on is on", flags.enabled, (v) => (flags.enabled = v)),
        check("Make accounts at first sign-in", flags.jitCreate, (v) => (flags.jitCreate = v)),
        check(
          "Require single sign-on (no passwords except the server owner)",
          flags.enforce,
          (v) => (flags.enforce = v),
        ),
      ),
      h(
        "div",
        { class: "row" },
        action(
          "Save",
          () =>
            call("PUT /v1/teams/:teamId/identity/sso", {
              params,
              body: { ...flags, ...(xml.value.trim() ? { metadataXml: xml.value } : {}) },
            }).then(reload),
          { kind: "act" },
        ),
        action("Test the connection", async () => {
          const result = await call("POST /v1/teams/:teamId/identity/sso/test", { params });
          testOut.replaceChildren(
            simulationBanner(result.simulation),
            table(
              ["Check", "Result"],
              result.checks.map((c) => [
                c.name ?? c.label ?? "",
                c.ok ? "Passed" : (c.message ?? "Failed"),
              ]),
            ),
          );
        }),
      ),
      testOut,
    );

    // ---- SCIM ----
    const tokenOut = h("div", {});
    let scimOn = scim.enabled;
    const groupMap = h("textarea", { "aria-label": "Group map (JSON)" });
    groupMap.value = JSON.stringify(scim.groupMap ?? [], null, 2);
    const showToken = (answer) =>
      answer.token
        ? tokenOut.replaceChildren(
            notice("Copy this token now. It is shown once; only a hash of it is kept.", "good"),
            h("code", {}, answer.token),
          )
        : null;
    const scimSection = h(
      "section",
      {},
      simulationBanner(scim.simulation),
      h("h3", {}, "SCIM provisioning"),
      h(
        "p",
        { class: "muted" },
        `Endpoint: ${scim.endpoint}. ${scim.tokenSet ? "A token is set." : "No token yet."}`,
      ),
      h(
        "div",
        { class: "row" },
        check("SCIM is on", scimOn, (v) => (scimOn = v)),
        action(
          "Save",
          async () => {
            let map;
            try {
              map = JSON.parse(groupMap.value || "[]");
            } catch {
              throw new Error("The group map is not valid JSON.");
            }
            showToken(
              await call("PUT /v1/teams/:teamId/identity/scim", {
                params,
                body: { enabled: scimOn, groupMap: map },
              }),
            );
          },
          { kind: "act" },
        ),
        action(
          "Make a new token",
          async () =>
            showToken(await call("POST /v1/teams/:teamId/identity/scim/token", { params })),
          { confirm: "The old token stops working. Make a new one?" },
        ),
      ),
      tokenOut,
      field("Group map: each group to a department or a role", groupMap),
      h("p", { class: "muted" }, scim.note),
    );

    // ---- domains ----
    const domain = h("input", { type: "text", placeholder: "example.com" });
    const role = select(["member", "viewer", "manager", "admin"], "member");
    const domainsSection = h(
      "section",
      {},
      simulationBanner(info.simulation),
      h("h3", {}, "Domains"),
      table(
        ["Domain", "Verified", "Capture", "Limit sign-up", "Add this TXT record", ""],
        domains.map((entry) => [
          entry.domain,
          entry.verified ? `Yes, ${when(entry.verifiedAt)}` : "No",
          entry.capture ? "On" : "Off",
          entry.restrictSignup ? "On" : "Off",
          h("code", {}, `${entry.record.name}  TXT  ${entry.record.value}`),
          h(
            "span",
            { class: "row" },
            action("Check it", () =>
              call("POST /v1/teams/:teamId/identity/domains/:domainId/verify", {
                params: { ...params, domainId: entry.id },
              }).then(reload),
            ),
            action(entry.capture ? "Stop capture" : "Offer capture", () =>
              call("PATCH /v1/teams/:teamId/identity/domains/:domainId", {
                params: { ...params, domainId: entry.id },
                body: { capture: !entry.capture },
              }).then(reload),
            ),
            action(
              "Remove",
              () =>
                call("DELETE /v1/teams/:teamId/identity/domains/:domainId", {
                  params: { ...params, domainId: entry.id },
                }).then(reload),
              { kind: "danger", confirm: `Remove ${entry.domain}?` },
            ),
          ),
        ]),
        "No domains yet.",
      ),
      h(
        "div",
        { class: "row" },
        field("Domain", domain),
        field("Role for people who join", role),
        action(
          "Add the domain",
          () =>
            call("POST /v1/teams/:teamId/identity/domains", {
              params,
              body: { domain: domain.value, defaultRole: role.value },
            }).then(reload),
          { kind: "act" },
        ),
      ),
    );

    return h("div", {}, ssoSection, scimSection, domainsSection);
  },
};
