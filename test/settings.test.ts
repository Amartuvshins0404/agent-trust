import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vitest";

import { classify, pathRulesFor, type ChangedFile } from "../lib/merge-lane.cjs";
import { DEFAULT_RULES, parseSettings, readSettings, SETUP_RULE } from "../lib/settings.cjs";
import { readWorkspace } from "../lib/workspace.cjs";
import t3codePackageDirs from "./fixtures/t3code/package-dirs.json" with { type: "json" };
import { pathRulesFor as oldT3codeRules } from "./fixtures/t3code/path-rules.cjs";

const edit = (filename: string): ChangedFile => ({
  filename,
  status: "modified",
  patch: "@@ -1,1 +1,1 @@\n-a\n+b",
});
const laneOf = (filename: string, options = {}) => classify([edit(filename)], options).lane;
const read = (text: string) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "agent-trust-settings-"));
  try {
    const file = NodePath.join(dir, "agent-trust.json");
    NodeFS.writeFileSync(file, text);
    return readSettings(file);
  } finally {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
};
const settingsWith = (raw: object) => parseSettings(JSON.stringify(raw));

describe("settings: the defaults with no settings file", () => {
  it.each([
    ["docs/guide/setup.md", "green"],
    ["README.md", "green"],
    ["packages/web/README.md", "green"],
    ["LICENSE", "green"],
    ["src/slug.ts", "amber"],
    ["packages/web/src/App.tsx", "amber"],
    ["src/styles/app.css", "amber"],
    ["public/logo.png", "amber"],
    [".github/workflows/ci.yml", "red"],
    [".github/workflows/blind-checks.yml", "red"],
    [".github/agent-trust.json", "red"],
    [".github/actions/setup/action.yml", "red"],
    ["package.json", "red"],
    ["packages/web/package.json", "red"],
    ["package-lock.json", "red"],
    ["pnpm-lock.yaml", "red"],
    ["yarn.lock", "red"],
    [".npmrc", "red"],
    ["db/migrations/0004_add_index.ts", "red"],
    ["db/schema.sql", "red"],
    ["prisma/schema.prisma", "red"],
    ["src/auth/session.ts", "red"],
    ["src/lib/permissions.ts", "red"],
    ["src/secrets.ts", "red"],
    [".env.production", "red"],
    ["tsconfig.json", "red"],
    ["packages/web/tsconfig.build.json", "red"],
    ["vite.config.ts", "red"],
    ["Dockerfile", "red"],
    ["vitest.config.ts", "red"],
    ["packages/web/vitest.workspace.config.mts", "red"],
    ["eslint.config.js", "red"],
    [".prettierrc", "red"],
    ["AGENTS.md", "red"],
    ["config/app.yaml", "red"],
    ["src/author.ts", "amber"],
  ])("%s -> %s", (filename, lane) => {
    expect(laneOf(filename)).toBe(lane);
  });

  it("a path the defaults do not know and that is not code is red as unknown", () => {
    expect(classify([edit("config/app.yaml")]).reasons.map((reason) => reason.rule)).toEqual([
      "unknown-path",
    ]);
  });

  it("the sample settings file in templates/ holds exactly the default rules", () => {
    const sample = JSON.parse(
      NodeFS.readFileSync(new URL("../templates/agent-trust.json", import.meta.url), "utf8"),
    );
    expect(sample.rules).toEqual(DEFAULT_RULES);
  });
});

describe("settings: custom rules", () => {
  const custom = settingsWith({
    baseBranch: "trunk",
    install: "pnpm install --frozen-lockfile",
    test: "pnpm vitest run",
    rules: [
      { id: "payments", lane: "red", why: "Moves money", paths: ["src/payments/**"] },
      { id: "app", lane: "amber", why: "App code", paths: ["src/**/*.{ts,tsx}"] },
      { id: "notes", lane: "green", why: "Notes", paths: ["/^notes\\//"] },
    ],
  });

  it.each([
    ["src/payments/refund.ts", "red", ["payments", "app"]],
    ["src/ui/Button.tsx", "amber", ["app"]],
    ["notes/2026-11.txt", "green", ["notes"]],
    ["docs/guide.md", "red", ["unknown-path"]],
    [".github/agent-trust.json", "red", [SETUP_RULE.id]],
    [".github/workflows/merge-lane.yml", "red", [SETUP_RULE.id]],
    [".github/workflows/blind-checks.yml", "red", [SETUP_RULE.id]],
  ])("%s -> %s by %j", (filename, lane, rules) => {
    const result = classify([edit(filename)], { settings: custom });
    expect(result.lane).toBe(lane);
    expect(result.reasons.map((reason) => reason.rule)).toEqual(rules);
  });

  it("keeps the other settings and the defaults for what the file leaves out", () => {
    expect(custom).toMatchObject({
      baseBranch: "trunk",
      install: "pnpm install --frozen-lockfile",
      test: "pnpm vitest run",
      runner: "vitest",
      node: "24",
    });
  });

  it("an inPackage rule covers code in a workspace package from package.json workspaces", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "agent-trust-workspace-"));
    try {
      NodeFS.writeFileSync(
        NodePath.join(dir, "package.json"),
        JSON.stringify({ workspaces: ["packages/*"] }),
      );
      NodeFS.mkdirSync(NodePath.join(dir, "packages", "api"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(dir, "packages", "api", "package.json"), "{}");
      NodeFS.mkdirSync(NodePath.join(dir, "packages", "notes"), { recursive: true });
      const packageDirs = readWorkspace(dir).map((pkg) => pkg.dir);
      const settings = settingsWith({
        rules: [{ id: "package", lane: "amber", why: "Package code", inPackage: true }],
      });
      expect([
        laneOf("packages/api/src/server.ts", { settings, packageDirs }),
        laneOf("packages/notes/todo.ts", { settings, packageDirs }),
      ]).toEqual(["amber", "red"]);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a suppression is allowed only where the settings allow it", () => {
    const settings = settingsWith({
      allowedSuppressions: [{ line: "/eslint-disable-next-line no-console -- \\S/", files: ["scripts/**"] }],
    });
    const suppressed = (filename: string, line: string): ChangedFile => ({
      filename,
      status: "modified",
      patch: `@@ -1,0 +1,1 @@\n+${line}`,
    });
    const reasonsFor = (file: ChangedFile) =>
      classify([file], { settings }).reasons.map((reason) => reason.rule);
    const allowed = "// eslint-disable-next-line no-console -- prints the report";
    expect([
      reasonsFor(suppressed("scripts/report.ts", allowed)),
      reasonsFor(suppressed("src/report.ts", allowed)),
      reasonsFor(suppressed("scripts/report.ts", "// eslint-disable-next-line no-console")),
    ]).toEqual([["code"], ["suppression", "code"], ["suppression", "code"]]);
  });
});

describe("settings: a broken settings file is red, never ignored", () => {
  it.each([
    ["not JSON", "{ rules: [] "],
    ["an unknown key", JSON.stringify({ rule: [] })],
    ["a lane that does not exist", JSON.stringify({ rules: [{ id: "a", lane: "blue", why: "x", paths: ["a"] }] })],
    ["a rule with no paths", JSON.stringify({ rules: [{ id: "a", lane: "green", why: "x", paths: [] }] })],
    ["a rule with no reason", JSON.stringify({ rules: [{ id: "a", lane: "green", paths: ["a/**"] }] })],
    ["a broken regex", JSON.stringify({ rules: [{ id: "a", lane: "green", why: "x", paths: ["/(/"] }] })],
    ["two rules with one id", JSON.stringify({ rules: [
      { id: "a", lane: "green", why: "x", paths: ["a/**"] },
      { id: "a", lane: "green", why: "y", paths: ["b/**"] },
    ] })],
    ["a rule that takes the setup rule's id", JSON.stringify({ rules: [{ id: SETUP_RULE.id, lane: "green", why: "x", paths: [".github/**"] }] })],
    ["an empty rule list", JSON.stringify({ rules: [] })],
    ["a runner it does not know yet", JSON.stringify({ runner: "jest" })],
    ["a test command on two lines", JSON.stringify({ test: "npx vitest run\nrm -rf /" })],
  ])("%s", (_name, text) => {
    const { settings, error } = read(text);
    expect(error).toEqual(expect.any(String));
    const result = classify([edit("docs/guide.md")], { settings, settingsError: error });
    expect(result.lane).toBe("red");
    expect(result.reasons[0]).toMatchObject({ rule: "bad-settings", files: [".github/agent-trust.json"] });
  });

  it("a missing settings file is not an error and uses the defaults", () => {
    expect(readSettings("/nonexistent/agent-trust.json").error).toBeNull();
  });
});

describe("settings: t3code's example gives the same lanes as the rules built into t3code", () => {
  const example = parseSettings(
    NodeFS.readFileSync(new URL("../examples/t3code/agent-trust.json", import.meta.url), "utf8"),
  );
  const paths = [
    ...NodeFS.readFileSync(new URL("./fixtures/t3code/paths.txt", import.meta.url), "utf8")
      .split("\n")
      .filter(Boolean),
    "apps/server/src/authority.ts",
    "apps/web/src/lib/accessibility.ts",
    "packages/shared/src/SignInButton.tsx",
    "apps/web/README.md",
    "tools/new-thing/run.ts",
    ".github/agent-trust.json",
  ];
  const ids = (rules: ReadonlyArray<{ readonly id: string }>) => rules.map((rule) => rule.id);
  const lane = (rules: ReadonlyArray<{ readonly lane: string }>) =>
    ["red", "amber", "green"].find((name) => rules.some((rule) => rule.lane === name));

  it(`over ${paths.length} paths: the same lane and the same rules, plus the setup rule on .github`, () => {
    const differ = paths.flatMap((file) => {
      const before = oldT3codeRules(file, t3codePackageDirs);
      const matched = pathRulesFor(file, example, t3codePackageDirs);
      const after = matched.length === 0 ? [{ id: "unknown-path", lane: "red" }] : matched;
      const same =
        lane(before) === lane(after) &&
        JSON.stringify(ids(before)) === JSON.stringify(ids(after).filter((id) => id !== SETUP_RULE.id));
      return same ? [] : [{ file, before: ids(before), after: ids(after) }];
    });
    expect(differ).toEqual([]);
  });
});
