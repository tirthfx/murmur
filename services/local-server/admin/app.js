import { ApiError, call } from "./api.js";
import { action, field, h, notice, select } from "./ui.js";
import members from "./pages/members.js";
import invites from "./pages/invites.js";
import teams from "./pages/teams.js";
import governance from "./pages/governance.js";
import policies from "./pages/policies.js";
import usage from "./pages/usage.js";
import audit from "./pages/audit.js";
import identity from "./pages/identity.js";
import plan from "./pages/plan.js";
import settings from "./pages/settings.js";

const PAGES = [
  members,
  invites,
  teams,
  governance,
  policies,
  usage,
  audit,
  identity,
  plan,
  settings,
];
const root = document.getElementById("root");

const state = { user: null, teams: [], teamId: "", pageId: "members" };

function signInForm(problem) {
  const email = h("input", { type: "email", autocomplete: "username", required: true });
  const password = h("input", {
    type: "password",
    autocomplete: "current-password",
    required: true,
  });
  const out = h("div", {});
  if (problem) out.append(notice(problem, "bad"));
  const form = h(
    "form",
    {},
    h("h1", {}, "Murmur admin"),
    h("p", { class: "muted" }, "Sign in with an account that is an admin of a team."),
    field("Email", email),
    field("Password", password),
    h("div", { class: "row" }, h("button", { type: "submit", class: "act" }, "Sign in")),
    out,
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    out.replaceChildren();
    try {
      await call("POST /v1/admin/session", {
        body: { email: email.value, password: password.value },
      });
      password.value = "";
      location.reload();
    } catch (error) {
      password.value = "";
      const wait = error instanceof ApiError && error.extra.retryAfterSeconds;
      out.append(
        notice(
          error instanceof Error
            ? `${error.message}${wait ? ` Try again in ${wait} seconds.` : ""}`
            : "That did not work.",
          "bad",
        ),
      );
    }
  });
  return h("main", { class: "center" }, form);
}

async function openPage(page, main) {
  main.replaceChildren(h("p", { class: "muted" }, "Loading..."));
  const team = state.teams.find((entry) => entry.id === state.teamId) ?? null;
  try {
    const node = await page.render({
      user: state.user,
      team,
      teams: state.teams,
      reload: () => openPage(page, main),
      refreshTeams: async () => {
        await loadTeams();
        draw();
      },
    });
    main.replaceChildren(h("h2", {}, page.title), node);
  } catch (error) {
    main.replaceChildren(
      h("h2", {}, page.title),
      notice(error instanceof Error ? error.message : "That did not load.", "bad"),
    );
  }
}

function shell() {
  const main = h("div", { class: "main" });
  const nav = h(
    "nav",
    { class: "nav", "aria-label": "Admin pages" },
    h("h1", {}, "Murmur admin"),
    PAGES.map((page) =>
      h(
        "button",
        {
          type: "button",
          "aria-current": page.id === state.pageId ? "page" : undefined,
          onclick: () => {
            state.pageId = page.id;
            draw();
          },
        },
        page.title,
      ),
    ),
  );
  const picker =
    state.teams.length > 0
      ? field(
          "Team",
          select(
            state.teams.map((team) => [team.id, team.name]),
            state.teamId,
            (id) => {
              state.teamId = id;
              draw();
            },
          ),
        )
      : h("span", { class: "muted" }, "No team yet");
  const top = h(
    "div",
    { class: "topbar" },
    picker,
    h(
      "span",
      { class: "row" },
      h("span", { class: "muted" }, `${state.user.name} (${state.user.email})`),
      action("Sign out", async () => {
        await call("DELETE /v1/admin/session");
        location.reload();
      }),
    ),
  );
  const content = h("div", {}, top, main);
  void openPage(PAGES.find((page) => page.id === state.pageId) ?? PAGES[0], main);
  return h("div", { class: "shell" }, nav, content);
}

function draw() {
  root.replaceChildren(shell());
}

async function loadTeams() {
  const answer = await call("GET /v1/teams");
  state.teams = answer.teams;
  if (!state.teams.some((team) => team.id === state.teamId))
    state.teamId = state.teams[0]?.id ?? "";
}

async function boot() {
  window.addEventListener("admin-signed-out", () =>
    root.replaceChildren(signInForm("Your session ended. Sign in again.")),
  );
  try {
    state.user = await call("GET /v1/me");
    await loadTeams();
  } catch (error) {
    // No session yet (a 401 already drew the form); anything else is shown.
    if (!(error instanceof ApiError && error.status === 401))
      root.replaceChildren(
        h(
          "main",
          { class: "center" },
          notice(error?.message ?? "The server did not answer.", "bad"),
        ),
      );
    else root.replaceChildren(signInForm(""));
    return;
  }
  draw();
}

void boot();
