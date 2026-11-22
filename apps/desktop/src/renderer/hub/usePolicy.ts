import { useEffect, useState } from "react";
import { EMPTY_POLICY_VIEW, type PolicyView } from "@murmur/shared";

/** The policy in force on this Mac (TM-13 to TM-16, TM-21), kept up to date; nothing here can be changed. */
export function usePolicy(): PolicyView {
  const [view, setView] = useState<PolicyView>(EMPTY_POLICY_VIEW);
  useEffect(() => {
    let active = true;
    void Promise.resolve(window.murmur.policyView?.()).then(
      (next) => active && next && setView(next),
      () => undefined,
    );
    const off = window.murmur.onPolicyChanged?.((next) => setView(next));
    return () => {
      active = false;
      off?.();
    };
  }, []);
  return view;
}
