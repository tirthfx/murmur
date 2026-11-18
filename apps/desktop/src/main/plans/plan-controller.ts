import { PLAN_LABELS, TRIAL, type PlanAction, type PlanState, type PlanTier } from "@murmur/shared";

const DAY_MS = 86_400_000;

export interface PlanControllerDeps {
  tier(): PlanTier;
  state(): PlanState;
  save(change: { plan?: PlanTier; planState: PlanState }): void;
  now(): number;
}

export interface PlanController {
  act(action: PlanAction): void;
  /** Ends a trial whose time is up; returns true if it did. */
  expire(): boolean;
  /** Notes a tier change made from Settings. */
  tierChanged(from: PlanTier, to: PlanTier): void;
}

/**
 * HB-19: the trial, the student label and the change log. A trial puts the tier on Pro and
 * remembers the one before; ending it (early or on time) puts that one back. Nothing here
 * charges anything.
 */
export function createPlanController(deps: PlanControllerDeps): PlanController {
  const logged = (state: PlanState, text: string): PlanState => ({
    ...state,
    log: [{ at: deps.now(), text }, ...state.log].slice(0, 50),
  });

  function end(reason: string): void {
    const state = deps.state();
    if (!state.trial) return;
    const back = state.trial.previousTier;
    deps.save({
      plan: back,
      planState: logged({ ...state, trial: null }, `${reason}; back to ${PLAN_LABELS[back]}`),
    });
  }

  return {
    act(action) {
      const state = deps.state();
      const now = deps.now();
      switch (action.type) {
        case "startTrial": {
          if (state.trial) return;
          const tier = deps.tier();
          deps.save({
            plan: tier === "free" ? "pro" : tier,
            planState: logged(
              {
                ...state,
                trial: {
                  startedAt: now,
                  endsAt: now + TRIAL.days * DAY_MS,
                  extended: false,
                  previousTier: tier,
                },
              },
              `Trial of Pro started for ${TRIAL.days} days`,
            ),
          });
          return;
        }
        case "extendTrial": {
          if (!state.trial || state.trial.extended) return;
          deps.save({
            planState: logged(
              {
                ...state,
                trial: {
                  ...state.trial,
                  endsAt: state.trial.endsAt + TRIAL.extendDays * DAY_MS,
                  extended: true,
                },
              },
              `Trial extended by ${TRIAL.extendDays} days`,
            ),
          });
          return;
        }
        case "endTrial":
          end("Trial ended early");
          return;
        case "student":
          if (state.student === action.on) return;
          deps.save({
            planState: logged(
              { ...state, student: action.on },
              action.on ? "Student label on" : "Student label off",
            ),
          });
      }
    },
    expire() {
      const trial = deps.state().trial;
      if (!trial || trial.endsAt > deps.now()) return false;
      end("Trial ended");
      return true;
    },
    tierChanged(from, to) {
      if (from === to) return;
      deps.save({
        planState: logged(
          deps.state(),
          `Plan changed from ${PLAN_LABELS[from]} to ${PLAN_LABELS[to]}`,
        ),
      });
    },
  };
}
