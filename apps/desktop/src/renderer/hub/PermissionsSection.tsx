import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  isRequestablePermissionKind,
  type PermissionKind,
  type PermissionsInfo,
} from "@murmur/shared";
import {
  PERMISSION_COPY,
  PERMISSION_ORDER,
  STATUS_BADGE_VARIANT,
  STATUS_LABEL,
  canRequest,
} from "./permissions";

/**
 * One row per permission. Statuses are read when the section appears and each time the
 * window regains focus, so a grant made in System Settings shows up without a restart.
 * Nothing is requested here until the user clicks a Request button.
 */
export function PermissionsSection() {
  const [info, setInfo] = useState<PermissionsInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<PermissionKind | null>(null);
  // Only the newest answer wins, so a slow older check cannot overwrite a newer one.
  const latest = useRef(0);
  const mounted = useRef(true);

  const apply = useCallback((ticket: number, value: PermissionsInfo) => {
    if (!mounted.current || ticket < latest.current) return;
    latest.current = ticket;
    setInfo(value);
    setProblem(null);
  }, []);

  const ticketCounter = useRef(0);
  const refresh = useCallback(() => {
    const ticket = ++ticketCounter.current;
    window.murmur.getPermissions().then(
      (value) => apply(ticket, value),
      () => {
        if (mounted.current) setProblem("Could not read permission status.");
      },
    );
  }, [apply]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const request = (kind: PermissionKind) => {
    if (!isRequestablePermissionKind(kind)) return;
    const ticket = ++ticketCounter.current;
    setBusy(kind);
    window.murmur
      .requestPermission(kind)
      .then(
        (value) => apply(ticket, value),
        () => {
          if (mounted.current) setProblem(`Could not request ${PERMISSION_COPY[kind].title}.`);
        },
      )
      .finally(() => {
        if (mounted.current) setBusy(null);
      });
  };

  const openSettings = (kind: PermissionKind) => {
    window.murmur.openPermissionSettings(kind).catch(() => {
      if (mounted.current) {
        setProblem(`Could not open System Settings for ${PERMISSION_COPY[kind].title}.`);
      }
    });
  };

  const message = problem ?? info?.message ?? null;

  return (
    <section className="hub-permissions" aria-labelledby="permissions-heading">
      <Heading level={2} id="permissions-heading">
        Permissions
      </Heading>
      <Text size="sm" color="secondary">
        Murmur asks only when you press Request. After you change a switch in System Settings, come
        back to this window and the status updates.
      </Text>
      {message ? (
        <Text size="sm" color="secondary" role="status" data-testid="permissions-message">
          {message}
        </Text>
      ) : null}
      <ul className="hub-permission-list">
        {PERMISSION_ORDER.map((kind) => {
          const copy = PERMISSION_COPY[kind];
          const status = info?.statuses[kind] ?? null;
          return (
            <li key={kind} className="hub-permission-row" data-testid={`permission-${kind}`}>
              <VStack gap={1}>
                <HStack gap={2} align="center">
                  <Text weight="medium">{copy.title}</Text>
                  <span data-testid={`permission-status-${kind}`}>
                    <Badge
                      variant={status ? STATUS_BADGE_VARIANT[status] : "neutral"}
                      label={status ? STATUS_LABEL[status] : "Checking"}
                    />
                  </span>
                </HStack>
                <Text size="sm" color="secondary">
                  {copy.reason}
                </Text>
                <HStack gap={2}>
                  {canRequest(kind) ? (
                    <Button
                      size="sm"
                      variant="primary"
                      label={`Request ${copy.title}`}
                      isDisabled={status === "granted" || busy === kind}
                      onClick={() => request(kind)}
                    >
                      Request
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    label={`Open System Settings for ${copy.title}`}
                    onClick={() => openSettings(kind)}
                  >
                    Open System Settings
                  </Button>
                </HStack>
              </VStack>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
