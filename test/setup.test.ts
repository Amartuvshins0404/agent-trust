import { describe, expect, it } from "vitest";

import { parseSettings } from "../lib/settings.cjs";
import { planRemove, planSetup, readTemplates } from "../lib/setup.cjs";

type Files = Readonly<Record<string, string>>;

const LANE = ".github/workflows/merge-lane.yml";
const PROOF = ".github/workflows/blind-checks.yml";
const SETTINGS = ".github/agent-trust.json";
const templates = readTemplates();
const reader = (files: Files) => (file: string) => files[file] ?? null;
const manifest = (pkg: object) => JSON.stringify({ name: "sample-app", private: true, ...pkg });
const vitest = manifest({ scripts: { test: "vitest run" }, devDependencies: { vitest: "5.0.0" } });

const apply = (files: Files) => {
  const plan = planSetup(reader(files), templates);
  return {
    plan,
    after: { ...files, ...Object.fromEntries(plan.write.map((entry) => [entry.file, entry.content])) },
  };
};

const projects: ReadonlyArray<{
  readonly name: string;
  readonly files: Files;
  readonly writes: ReadonlyArray<string>;
  readonly settings?: { readonly runner?: string; readonly install: string; readonly test: string };
  readonly why?: RegExp;
}> = [
  {
    name: "npm and Vitest",
    files: { "package.json": vitest, "package-lock.json": "{}" },
    writes: [LANE, PROOF],
  },
  {
    name: "npm and Vitest with no lockfile",
    files: { "package.json": vitest },
    writes: [LANE, PROOF, SETTINGS],
    settings: { install: "npm install", test: "npx vitest run" },
  },
  {
    name: "pnpm and Vitest",
    files: { "package.json": vitest, "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" },
    writes: [LANE, PROOF, SETTINGS],
    settings: {
      install: "corepack enable && pnpm install --frozen-lockfile",
      test: "pnpm exec vitest run",
    },
  },
  {
    name: "Yarn Berry and Vitest only in the dev dependencies",
    files: {
      "package.json": manifest({ devDependencies: { vitest: "5.0.0" } }),
      "yarn.lock": "",
      ".yarnrc.yml": "nodeLinker: node-modules\n",
    },
    writes: [LANE, PROOF, SETTINGS],
    settings: { install: "corepack enable && yarn install --immutable", test: "yarn vitest run" },
  },
  {
    name: "npm and Jest",
    files: {
      "package.json": manifest({ scripts: { test: "jest" }, devDependencies: { jest: "30.0.0" } }),
      "package-lock.json": "{}",
    },
    writes: [LANE, PROOF, SETTINGS],
    settings: { runner: "jest", install: "npm ci", test: "npx jest" },
  },
  {
    name: "only the jest-expo preset, with no test script",
    files: {
      "package.json": manifest({ devDependencies: { "jest-expo": "58.0.0" } }),
      "package-lock.json": "{}",
    },
    writes: [LANE, PROOF, SETTINGS],
    settings: { runner: "jest", install: "npm ci", test: "npx jest" },
  },
  {
    name: "pnpm and ts-jest with no test script",
    files: {
      "package.json": manifest({ devDependencies: { "ts-jest": "29.4.0" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    },
    writes: [LANE, PROOF, SETTINGS],
    settings: {
      runner: "jest",
      install: "corepack enable && pnpm install --frozen-lockfile",
      test: "pnpm exec jest",
    },
  },
  {
    name: "only a jest.config.ts",
    files: { "package.json": manifest({}), "yarn.lock": "", "jest.config.ts": "export default {};\n" },
    writes: [LANE, PROOF, SETTINGS],
    settings: { runner: "jest", install: "corepack enable && yarn install --frozen-lockfile", test: "yarn jest" },
  },
  {
    name: "only a jest key in package.json",
    files: { "package.json": manifest({ jest: { testEnvironment: "node" } }), "package-lock.json": "{}" },
    writes: [LANE, PROOF, SETTINGS],
    settings: { runner: "jest", install: "npm ci", test: "npx jest" },
  },
  {
    name: "Vitest with jest-dom matchers",
    files: {
      "package.json": manifest({
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "5.0.0", "@testing-library/jest-dom": "6.0.0" },
      }),
      "package-lock.json": "{}",
    },
    writes: [LANE, PROOF],
  },
  {
    name: "a test script that is neither Vitest nor Jest",
    files: { "package.json": manifest({ scripts: { test: "mocha" } }), "package-lock.json": "{}" },
    writes: [LANE],
    why: /not supported for the test script "mocha"/,
  },
  {
    name: "bun and Vitest",
    files: { "package.json": vitest, "bun.lock": "{}" },
    writes: [LANE],
    why: /not supported with bun/,
  },
  {
    name: "no tests",
    files: {
      "package.json": manifest({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
      "package-lock.json": "{}",
    },
    writes: [LANE],
    why: /no tests/,
  },
  {
    name: "not JavaScript",
    files: { "go.mod": "module example.com/sample\n" },
    writes: [LANE],
    why: /not a JavaScript or TypeScript project/,
  },
];

describe("setup writes only the files a project needs", () => {
  it.each(projects)("$name", (row) => {
    const { plan, after } = apply(row.files);
    expect(plan.blocked).toEqual([]);
    expect(plan.write.map((entry) => entry.file)).toEqual(row.writes);
    for (const file of [LANE, PROOF].filter((name) => row.writes.includes(name))) {
      expect(after[file]).toBe(templates[file]);
    }
    if (row.settings) {
      const settings = parseSettings(after[SETTINGS] ?? "");
      expect({ runner: settings.runner, install: settings.install, test: settings.test }).toEqual({
        runner: "vitest",
        ...row.settings,
      });
    }
    expect(plan.proof.why).toEqual(row.why ? expect.stringMatching(row.why) : undefined);
  });

  it.each(projects)("running it again on $name changes nothing", (row) => {
    const { after } = apply(row.files);
    const again = planSetup(reader(after), templates);
    expect({ write: again.write, kept: again.kept, blocked: again.blocked }).toEqual({
      write: [],
      kept: [],
      blocked: [],
    });
  });
});

describe("setup never overwrites a file it did not write", () => {
  const base = { "package.json": vitest, "pnpm-lock.yaml": "" };

  it("stops and writes nothing when a workflow with one of the two names is someone else's", () => {
    const plan = planSetup(reader({ ...base, [PROOF]: "name: Proof\non: push\njobs: {}\n" }), templates);
    expect(plan.blocked).toEqual([PROOF]);
    expect(plan.write).toEqual([]);
  });

  it("keeps a caller pinned to another ref and a settings file the owner edited", () => {
    const pinned = (templates[LANE] ?? "").replace("@v0", "@0123456789abcdef0123456789abcdef01234567");
    const settings = '{ "install": "pnpm install", "test": "pnpm test" }\n';
    const plan = planSetup(reader({ ...base, [LANE]: pinned, [SETTINGS]: settings }), templates);
    expect(plan.blocked).toEqual([]);
    expect(plan.write.map((entry) => entry.file)).toEqual([PROOF]);
    expect(plan.kept).toEqual([LANE, SETTINGS]);
  });
});

describe("remove deletes what setup wrote", () => {
  it("deletes the callers and the settings file of a set-up project", () => {
    const { after } = apply({ "package.json": vitest, "pnpm-lock.yaml": "" });
    expect(planRemove(reader(after))).toEqual({ remove: [LANE, PROOF, SETTINGS], kept: [] });
  });

  it("leaves a workflow with one of the two names that does not call agent-trust", () => {
    const files = { [LANE]: templates[LANE] ?? "", [PROOF]: "name: Proof\non: push\njobs: {}\n" };
    expect(planRemove(reader(files))).toEqual({ remove: [LANE], kept: [PROOF] });
  });
});
