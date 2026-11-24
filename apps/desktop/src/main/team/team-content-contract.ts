import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { TEAM_CONTENT_VERSION, type TeamClient, type TeamContentClient } from "@murmur/shared";
import {
  CONTRACT_PASSWORD,
  expectError,
  expectOk,
  type ContractBackend,
  type ContractOptions,
} from "./team-client-contract";

/**
 * The contract for shared Skills and folders (`teamContent.v1`, NT-16, NT-17): what every backend
 * that implements `TeamContentClient` does the same way. It runs on the same fixture as the team
 * client contract and talks to the backend only through the interface; the owner publishes, and
 * members and viewers are made with the fixture's `addMember`.
 */
type Client = TeamClient & TeamContentClient;

const withContent = (client: TeamClient): Client => {
  if (!("contentVersion" in client)) throw new Error("This client has no shared content.");
  return client as Client;
};

const SKILL = (name: string) => ({
  name,
  description: "Sums up a call",
  body: `---\nname: ${name}\n---\nSummarise the call in five lines.`,
});

export function describeTeamContentContract(name: string, options: ContractOptions): void {
  describe(`team content contract: ${name}`, () => {
    let backend: ContractBackend;
    beforeEach(async () => {
      backend = await options.start();
    });
    afterEach(() => backend.close());

    async function owner() {
      const session = expectOk(
        await backend.client(null).setupOwner({
          name: "Ada",
          email: backend.admin.ownerEmail,
          password: CONTRACT_PASSWORD,
        }),
      );
      const teamId = await backend.admin.createTeam("Acme");
      return { client: withContent(backend.client(session.token)), session, teamId };
    }

    async function member(teamId: string, role = "member") {
      const email = await backend.admin.addMember(teamId, `Bea ${role}`, role);
      const session = expectOk(
        await backend.client(null).signIn({ email, password: CONTRACT_PASSWORD }),
      );
      return { client: withContent(backend.client(session.token)), session, email };
    }

    /** The id of a person in the team, from the people list a folder's member picker uses. */
    async function idOf(client: Client, teamId: string, email: string): Promise<string> {
      const people = expectOk(await client.people(teamId));
      const found = people.find((person) => person.email.toLowerCase() === email.toLowerCase());
      if (!found) throw new Error(`${email} is not in the team`);
      return found.userId;
    }

    const content = async (client: Client, teamId: string) => {
      const answer = expectOk(await client.content(teamId));
      if (answer.unchanged) throw new Error("expected content");
      return answer;
    };

    it("is version 1, and an empty team has neither Skills nor folders", async () => {
      const { client, teamId } = await owner();
      expect(client.contentVersion).toBe(TEAM_CONTENT_VERSION);
      expect(TEAM_CONTENT_VERSION).toBe("teamContent.v1");
      const answer = await content(client, teamId);
      expect(answer.skills).toEqual([]);
      expect(answer.folders).toEqual([]);
    });

    it("lists the people in a team, with their role", async () => {
      const { client, teamId, session } = await owner();
      const viewer = await member(teamId, "viewer");
      const people = expectOk(await client.people(teamId));
      expect(people.map((person) => person.role).sort()).toEqual(["owner", "viewer"]);
      expect(people.find((person) => person.email === session.user.email)).toMatchObject({
        name: "Ada",
        role: "owner",
      });
      expect(people.some((person) => person.email === viewer.email)).toBe(true);
    });

    describe("Skills", () => {
      it("an admin publishes one and members and viewers read it", async () => {
        const { client, teamId } = await owner();
        const made = expectOk(await client.publishSkill(teamId, SKILL("Call recap")));
        expect(made).toMatchObject({ name: "Call recap", version: 1, scope: "company" });
        for (const role of ["member", "viewer"]) {
          const person = await member(teamId, role);
          const answer = await content(person.client, teamId);
          expect(answer.skills.map((skill) => skill.name)).toEqual(["Call recap"]);
          expect(answer.skills[0]?.body).toContain("five lines");
        }
      });

      it("a member and a viewer cannot publish, change or remove one", async () => {
        const { client, teamId } = await owner();
        const made = expectOk(await client.publishSkill(teamId, SKILL("Call recap")));
        for (const role of ["member", "viewer"]) {
          const person = await member(teamId, role);
          expectError(await person.client.publishSkill(teamId, SKILL("Mine")), "forbidden");
          expectError(
            await person.client.updateSkill(teamId, made.id, { name: "Hijacked" }),
            "forbidden",
          );
          expectError(await person.client.removeSkill(teamId, made.id), "forbidden");
        }
      });

      it("a change is a new version with the old one kept, and the same text is no change", async () => {
        const { client, teamId } = await owner();
        const made = expectOk(await client.publishSkill(teamId, SKILL("Call recap")));
        const same = expectOk(
          await client.updateSkill(teamId, made.id, { description: "Sums up a call" }),
        );
        expect(same.changed).toBe(false);
        expect(same.skill.version).toBe(1);
        const changed = expectOk(
          await client.updateSkill(teamId, made.id, {
            body: "---\nname: Call recap\n---\nSummarise the call in three lines.",
          }),
        );
        expect(changed.changed).toBe(true);
        expect(changed.skill.version).toBe(2);
        const versions = expectOk(await client.skillVersions(teamId, made.id));
        expect(versions.map((v) => v.version)).toEqual([2, 1]);
        expect(versions[1]?.body).toContain("five lines");
      });

      it("says invalid for what is not acceptable and conflict for a duplicate name", async () => {
        const { client, teamId } = await owner();
        expectError(await client.publishSkill(teamId, { ...SKILL("x"), name: "" }), "invalid");
        expectError(
          await client.publishSkill(teamId, { ...SKILL("No prompt"), body: "   " }),
          "invalid",
        );
        expectOk(await client.publishSkill(teamId, SKILL("Dup")));
        expectError(await client.publishSkill(teamId, SKILL("dup")), "conflict");
      });

      it("a removed Skill is gone for everyone", async () => {
        const { client, teamId } = await owner();
        const made = expectOk(await client.publishSkill(teamId, SKILL("Call recap")));
        expectOk(await client.removeSkill(teamId, made.id));
        const bea = await member(teamId);
        expect((await content(bea.client, teamId)).skills).toEqual([]);
        expectError(await bea.client.skillVersions(teamId, made.id), "not_found");
      });
    });

    describe("folders", () => {
      it("two people share a folder: one adds a note, the other reads it", async () => {
        const { client, teamId, session } = await owner();
        const bea = await member(teamId);
        const folder = expectOk(
          await bea.client.createFolder(teamId, {
            name: "Q4 deal",
            kind: "shared",
            members: [await idOf(client, teamId, session.user.email)],
          }),
        );
        expect(folder).toMatchObject({ name: "Q4 deal", kind: "shared", canWrite: true });
        const note = expectOk(
          await bea.client.shareNote(teamId, folder.id, {
            title: "Kickoff call",
            body: "# Kickoff\n- Agreed on the date",
            sourceRef: "meeting:42",
          }),
        );
        const seen = (await content(client, teamId)).folders[0]!;
        expect(seen.name).toBe("Q4 deal");
        expect(seen.items.map((item) => item.title)).toEqual(["Kickoff call"]);
        expect(JSON.stringify(seen.items)).not.toContain("Agreed on the date");
        const read = expectOk(await client.readNote(teamId, folder.id, note.id));
        expect(read).toMatchObject({ title: "Kickoff call", sourceRef: "meeting:42" });
        expect(read.body).toContain("Agreed on the date");
      });

      it("a person who is not in a shared folder does not see it, and a viewer adds to none", async () => {
        const { teamId } = await owner();
        const bea = await member(teamId);
        const folder = expectOk(
          await bea.client.createFolder(teamId, { name: "Private-ish", kind: "shared" }),
        );
        const note = expectOk(
          await bea.client.shareNote(teamId, folder.id, { title: "Note", body: "text" }),
        );
        const vera = await member(teamId, "viewer");
        expect((await content(vera.client, teamId)).folders).toEqual([]);
        expectError(await vera.client.readNote(teamId, folder.id, note.id), "not_found");
        expectError(
          await vera.client.shareNote(teamId, folder.id, { title: "x", body: "y" }),
          "forbidden",
        );
        expectError(
          await vera.client.createFolder(teamId, { name: "Mine", kind: "shared" }),
          "forbidden",
        );
      });

      it("a read-only member reads and does not add, and a person may leave", async () => {
        const { teamId } = await owner();
        const bea = await member(teamId);
        const cal = await member(teamId);
        const calId = await idOf(bea.client, teamId, cal.email);
        const folder = expectOk(
          await bea.client.createFolder(teamId, {
            name: "Team notes",
            kind: "shared",
            members: [calId],
          }),
        );
        expectOk(await bea.client.setFolderMember(teamId, folder.id, calId, false));
        const mine = (await content(cal.client, teamId)).folders[0]!;
        expect(mine.canWrite).toBe(false);
        expectError(
          await cal.client.shareNote(teamId, folder.id, { title: "x", body: "y" }),
          "forbidden",
        );
        expectOk(await cal.client.removeFolderMember(teamId, folder.id, calId));
        expect((await content(cal.client, teamId)).folders).toEqual([]);
      });

      it("only the person who shared a note, or the folder's maker, removes it; a company folder is an admin's", async () => {
        const { client, teamId } = await owner();
        const bea = await member(teamId);
        expectError(
          await bea.client.createFolder(teamId, { name: "All hands", kind: "company" }),
          "forbidden",
        );
        const company = expectOk(
          await client.createFolder(teamId, { name: "All hands", kind: "company" }),
        );
        const note = expectOk(
          await bea.client.shareNote(teamId, company.id, { title: "Note", body: "text" }),
        );
        const other = await member(teamId);
        expectError(await other.client.removeNote(teamId, company.id, note.id), "forbidden");
        expectOk(await bea.client.removeNote(teamId, company.id, note.id));
      });

      it("a bad name or kind is invalid, a duplicate is a conflict, and a removed folder is gone", async () => {
        const { client, teamId } = await owner();
        expectError(await client.createFolder(teamId, { name: "", kind: "shared" }), "invalid");
        const folder = expectOk(await client.createFolder(teamId, { name: "Q4", kind: "shared" }));
        expectError(await client.createFolder(teamId, { name: "q4", kind: "shared" }), "conflict");
        expectOk(await client.removeFolder(teamId, folder.id));
        expect((await content(client, teamId)).folders).toEqual([]);
      });
    });

    describe("keeping in step and the gates", () => {
      it("the revision moves with a change, and says unchanged when it has not", async () => {
        const { client, teamId } = await owner();
        const first = expectOk(await client.content(teamId));
        expect(expectOk(await client.content(teamId, first.revision))).toEqual({
          unchanged: true,
          revision: first.revision,
        });
        expectOk(await client.publishSkill(teamId, SKILL("Call recap")));
        const next = expectOk(await client.content(teamId, first.revision));
        expect(next.unchanged).toBe(false);
        expect(next.revision).toBeGreaterThan(first.revision);
      });

      it("is for people in the team, and for plans that have teams", async () => {
        const { client, teamId } = await owner();
        const other = await backend.admin.createTeam("Other");
        const bea = await member(other);
        expectError(await bea.client.content(teamId), "forbidden");
        expectError(await withContent(backend.client(null)).content(teamId), "unauthorized");
        await backend.admin.setPlan("free");
        expectError(await client.content(teamId), "forbidden");
      });

      it("says offline when it cannot be reached and refused when the rules do not allow the address", async () => {
        expectError(await withContent(backend.unreachable()).content("t"), "offline");
        expectError(await withContent(backend.refused()).content("t"), "refused");
      });
    });
  });
}
