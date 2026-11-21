import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import {
  CONNECTOR_FEATURES,
  connectorFeatureState,
  type ConnectorFeatureState,
} from "@murmur/shared";

/**
 * The disabled state of a feature that needs a connector (CN-15): nothing when the feature can
 * work, otherwise one banner that says why, with Reconnect when an account needs attention and a
 * way to the Connectors page when nothing is connected. Features put this above their controls.
 */
export function ConnectorNotice({ featureId }: { featureId: string }) {
  const [state, setState] = useState<ConnectorFeatureState | null>(null);
  const [waiting, setWaiting] = useState(false);
  const feature = CONNECTOR_FEATURES.find((candidate) => candidate.id === featureId);

  useEffect(() => {
    if (!feature) return;
    let live = true;
    const load = () =>
      window.murmur.connectorsView().then(
        (view) => live && setState(connectorFeatureState(feature, view)),
        () => undefined,
      );
    void load();
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
    };
  }, [feature]);

  if (!feature || !state || state.enabled) return null;

  const reconnect = state.reconnect;
  return (
    <Banner
      status="info"
      title={`${feature.name} is off`}
      description={state.reason ?? undefined}
      endContent={
        reconnect ? (
          <Button
            variant="secondary"
            label={`Reconnect ${reconnect.email}`}
            isDisabled={waiting}
            onClick={() => {
              setWaiting(true);
              void window.murmur
                .connectorConnect(reconnect.connectorId, reconnect.email)
                .finally(() => setWaiting(false))
                .then(() => window.murmur.connectorsView())
                .then((view) => setState(connectorFeatureState(feature, view)));
            }}
          >
            Reconnect
          </Button>
        ) : (
          <Button
            variant="secondary"
            label="Open Connectors"
            onClick={() => {
              window.location.hash = "#/connectors";
            }}
          >
            Open Connectors
          </Button>
        )
      }
    />
  );
}
