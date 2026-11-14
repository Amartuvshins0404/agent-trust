const fs = require("node:fs");
const path = require("node:path");

const VITEST_CONFIGS = ["vitest.config", "vite.config"].flatMap((name) =>
  ["ts", "mts", "cts", "js", "mjs", "cjs"].map((ext) => `${name}.${ext}`),
);

function vitestOwner(cwd, test) {
  for (let dir = path.posix.dirname(test); ; dir = path.posix.dirname(dir)) {
    for (const name of VITEST_CONFIGS) {
      const file = path.join(cwd, dir, name);
      if (!fs.existsSync(file)) continue;
      if (name.startsWith("vitest.") || /\btest\s*:/.test(fs.readFileSync(file, "utf8"))) {
        return { dir, config: file };
      }
    }
    if (dir === ".") {
      const any = VITEST_CONFIGS.map((name) => path.join(cwd, name)).find((file) => fs.existsSync(file));
      return { dir: ".", config: any ?? null };
    }
  }
}

function vitestConfig(cwd, owner, tests) {
  const root = path.join(cwd, owner.dir);
  return [
    'import path from "node:path";',
    owner.config === null
      ? "const base = {};"
      : `import base from ${JSON.stringify(owner.config)};`,
    `const root = ${JSON.stringify(root)};`,
    `const tests = ${JSON.stringify(tests.map((test) => path.join(cwd, test)))};`,
    'const loaded = typeof base === "function" ? await base({ command: "serve", mode: "test" }) : base;',
    "const { projects, ...test } = loaded.test ?? {};",
    "const matches = (dir, file, globs) => (globs ?? []).some((glob) => path.matchesGlob(path.relative(dir, file), glob));",
    "const narrow = (project) => {",
    '  const dir = path.resolve(root, project.test?.root ?? "");',
    "  const include = tests.filter((file) => matches(dir, file, project.test?.include) && !matches(dir, file, project.test?.exclude));",
    "  return { ...project, test: { ...project.test, include: include.map((file) => path.relative(dir, file)) } };",
    "};",
    `const inner = ${owner.dir === "." ? "[]" : "(projects ?? [])"}`,
    '  .filter((project) => typeof project === "object" && !project.test?.browser?.enabled)',
    "  .map(narrow)",
    "  .filter((project) => project.test.include.length > 0);",
    "export default {",
    "  ...loaded,",
    "  root,",
    "  test: inner.length > 0",
    "    ? { ...test, projects: inner }",
    "    : { ...test, include: tests.map((file) => path.relative(root, file)) },",
    "};",
    "",
  ].join("\n");
}

const RUNNERS = {
  vitest: {
    reportArgs: (file) => ["--reporter=json", `--outputFile=${file}`],
    stryker: {
      plugin: "@stryker-mutator/vitest-runner",
      testRunner: "vitest",
      owner: vitestOwner,
      configName: (name) => `${name}.vitest.config.mjs`,
      writeConfig: vitestConfig,
      options: (configFile) => ({ vitest: { configFile, related: false } }),
    },
  },
};

const shellQuote = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;

function testCommand(settings, reportFile, files) {
  const args = [...RUNNERS[settings.runner].reportArgs(reportFile), ...files];
  return `${settings.test} ${args.map(shellQuote).join(" ")}`;
}

module.exports = { RUNNERS, testCommand, vitestOwner };
