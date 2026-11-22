import type { AuditFilter } from "../audit.ts";
import { HttpError, reply, text, type Route } from "../http.ts";
import type { SiemConfig } from "../siem.ts";
import { me, type RouteDeps } from "./context.ts";

function auditFilter(url: URL): AuditFilter {
  const filter: AuditFilter = {};
  const get = (key: string) => url.searchParams.get(key) || undefined;
  const actor = get("actor");
  const action = get("action");
  const target = get("target");
  if (actor) filter.actor = actor;
  if (action) filter.action = action;
  if (target) filter.target = target;
  if (url.searchParams.has("from")) filter.from = Number(url.searchParams.get("from"));
  if (url.searchParams.has("to")) filter.to = Number(url.searchParams.get("to"));
  return filter;
}

/** The audit log, its export and verification, and the retention and SIEM settings (TM-12). */
export function auditRoutes({ audit, siem, settings, policy, autoFlush }: RouteDeps): Route[] {
  return [
    {
      method: "GET",
      path: "/v1/audit",
      access: { action: "audit.view" },
      handler: (ctx) =>
        reply(
          200,
          audit.list(auditFilter(ctx.url), {
            limit: Number(ctx.url.searchParams.get("limit") ?? 50) || 50,
            ...(ctx.url.searchParams.has("before")
              ? { before: Number(ctx.url.searchParams.get("before")) }
              : {}),
          }),
        ),
    },
    {
      method: "GET",
      path: "/v1/audit/export",
      access: { action: "audit.view" },
      handler(ctx) {
        const body = audit.exportJsonLines(auditFilter(ctx.url));
        audit.record({
          actorId: me(ctx).id,
          action: "audit.exported",
          detail: { rows: body === "" ? 0 : body.trimEnd().split("\n").length },
        });
        return {
          status: 200,
          raw: body,
          headers: { "content-disposition": 'attachment; filename="murmur-audit.jsonl"' },
        };
      },
    },
    {
      method: "POST",
      path: "/v1/audit/verify",
      access: { action: "audit.view" },
      handler: () => reply(200, audit.verify()),
    },
    {
      method: "GET",
      path: "/v1/audit/settings",
      access: { action: "audit.view" },
      handler: () => reply(200, { retentionDays: audit.retentionDays(), siem: siem.status() }),
    },
    {
      method: "PUT",
      path: "/v1/audit/settings",
      access: { action: "audit.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const changed: Record<string, string | number> = {};
        if (body["retentionDays"] !== undefined) {
          const days = Number(body["retentionDays"]);
          if (!Number.isInteger(days) || days < 30 || days > 3650)
            throw new HttpError(400, "invalid_retention", "Keep the log between 30 and 3650 days.");
          settings.set("team.audit.retentionDays", days);
          changed["retentionDays"] = days;
        }
        const patch: Partial<SiemConfig> = {};
        if (body["siemMode"] !== undefined)
          patch.mode = text(body, "siemMode") as SiemConfig["mode"];
        if (body["siemWebhookUrl"] !== undefined) patch.webhookUrl = text(body, "siemWebhookUrl");
        if (patch.webhookUrl && policy.hostBlockedAnywhere(patch.webhookUrl))
          throw new HttpError(400, "blocked_by_policy", "A team's policy blocks that address.");
        if (Object.keys(patch).length > 0) {
          const result = siem.setConfig(patch);
          if (!result.ok) throw new HttpError(400, "invalid_siem", result.message);
          if (patch.mode !== undefined) changed["siemMode"] = patch.mode;
          if (patch.webhookUrl !== undefined) changed["siemWebhook"] = "changed";
        }
        audit.record({ actorId: me(ctx).id, action: "audit.settings_changed", detail: changed });
        return reply(200, { retentionDays: audit.retentionDays(), siem: siem.status() });
      },
    },
    {
      method: "POST",
      path: "/v1/audit/siem/retry",
      access: { action: "audit.manage" },
      handler(ctx) {
        const count = siem.retryFailed();
        audit.record({ actorId: me(ctx).id, action: "audit.siem_retried", detail: { count } });
        if (autoFlush) void siem.flush().catch(() => undefined);
        return reply(200, siem.status());
      },
    },
  ];
}
