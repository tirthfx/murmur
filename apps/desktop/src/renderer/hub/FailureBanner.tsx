import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";

/**
 * Says that an action failed. Most buttons ask main to do something and then read the page
 * again; when that request is refused or throws, nothing catches it, and without this the click
 * would seem to have done nothing.
 */
export function FailureBanner() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onFailure = (event: PromiseRejectionEvent) => {
      console.error(event.reason);
      setFailed(true);
    };
    window.addEventListener("unhandledrejection", onFailure);
    return () => window.removeEventListener("unhandledrejection", onFailure);
  }, []);

  if (!failed) return null;
  return (
    <div className="hub-failure">
      <Banner
        status="error"
        title="That did not work"
        description="Try again. If it keeps happening, quit Murmur and open it again."
        endContent={
          <Button
            size="sm"
            variant="secondary"
            label="Dismiss the error"
            onClick={() => setFailed(false)}
          >
            Dismiss
          </Button>
        }
      />
    </div>
  );
}
