const fs = require("node:fs");
const path = require("node:path");

const { RUNNERS } = require("./runners.cjs");

const SETTINGS_FILE = ".github/agent-trust.json";
const LANES = ["green", "amber", "red"];

const SETUP_RULE = {
  id: "agent-trust-setup",
  lane: "red",
  why: "Changes the merge lane settings, a workflow or an action, which decide what judges and runs on pull requests",
  paths: [SETTINGS_FILE, ".github/workflows/**", ".github/actions/**"],
};

const DEFAULT_RULES = [
  {
    id: "ci",
    lane: "red",
    why: "Changes CI or release configuration",
    paths: [
      ".github/**",
      ".gitlab-ci.yml",
      ".circleci/**",
      ".buildkite/**",
      "azure-pipelines.yml",
      "Jenkinsfile",
    ],
  },
  {
    id: "dependencies",
    lane: "red",
    why: "Changes dependencies, package manifests or lockfiles",
    paths: [
      "**/package.json",
      "**/{package-lock.json,npm-shrinkwrap.json,yarn.lock,pnpm-lock.yaml,bun.lock,bun.lockb}",
      "pnpm-workspace.yaml",
      "**/{.npmrc,.yarnrc,.yarnrc.yml,.pnpmfile.cjs}",
      ".yarn/**",
      "patches/**",
    ],
  },
  {
    id: "migrations",
    lane: "red",
    why: "Changes the database schema or its migrations",
    paths: ["**/migrations/**", "**/*.sql", "**/*.prisma"],
  },
  {
    id: "auth",
    lane: "red",
    why: "Changes sign-in, permissions, access control or secrets",
    paths: [
      "/(^|\\/)[^/]*(auth(?!or)|login|signin|sign-in|permission|credential|secret|passkey|password|rbac)[^/]*(\\/|$)/i",
      "**/.env",
      "**/.env.*",
    ],
  },
  {
    id: "build-config",
    lane: "red",
    why: "Changes build, compiler or container configuration",
    paths: [
      "**/{tsconfig,jsconfig}*.json",
      "**/{vite,webpack,rollup,esbuild,babel,swc,next,nuxt,astro,svelte,turbo,metro,tsup}.config.*",
      "**/{.babelrc,.babelrc.*,.swcrc,.browserslistrc,turbo.json,nx.json}",
      "**/Dockerfile*",
      "**/{docker-compose,compose}*.{yml,yaml}",
      ".gitattributes",
      ".gitignore",
    ],
  },
  {
    id: "gates",
    lane: "red",
    why: "Changes a lint, format, type-check or test gate",
    paths: [
      "**/{vitest,jest,playwright,cypress,stryker}*.config.*",
      "**/{vitest,jest}.setup.*",
      "**/setupTests.*",
      "**/{.eslintrc,.eslintrc.*,eslint.config.*,.oxlintrc*,oxlint*.json,biome.json,biome.jsonc}",
      "**/{.prettierrc,.prettierrc.*,prettier.config.*,.stylelintrc*,knip.json,knip.jsonc}",
      "**/{.lintstagedrc*,lint-staged.config.*,.nycrc*,.c8rc*}",
      ".husky/**",
      "lefthook.{yml,yaml}",
    ],
  },
  {
    id: "model-text",
    lane: "red",
    why: "Changes text that AI models read (agent instructions, prompts)",
    paths: ["**/{AGENTS,CLAUDE,GEMINI}.md", ".{agents,claude,cursor}/**"],
  },
  {
    id: "code",
    lane: "amber",
    why: "Ordinary code",
    paths: [
      "**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,vue,svelte,astro,css,scss,sass,less,html}",
      "**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,otf}",
    ],
  },
  {
    id: "docs",
    lane: "green",
    why: "Documentation only",
    paths: ["docs/**", "**/*.{md,mdx}", "LICENSE*"],
  },
];

const DEFAULTS = {
  baseBranch: null,
  node: "24",
  install: "npm ci",
  runner: "vitest",
  allowedSuppressions: [],
  rules: DEFAULT_RULES,
};

const defaultTest = (runner) => `npx ${RUNNERS[runner].command}`;

const escape = (text) => text.replace(/[.+^$()|[\]\\]/g, "\\$&");

function globSource(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) throw new Error("has a { with no closing }");
      out += `(?:${glob
        .slice(i + 1, end)
        .split(",")
        .map(globSource)
        .join("|")})`;
      i = end;
    } else out += escape(c);
  }
  return out;
}

function compilePattern(text) {
  if (typeof text !== "string" || text === "") throw new Error("a pattern must be a non-empty string");
  const regex = /^\/(.+)\/([imsu]*)$/s.exec(text);
  try {
    return regex ? new RegExp(regex[1], regex[2]) : new RegExp(`^${globSource(text)}$`);
  } catch (error) {
    throw new Error(`${JSON.stringify(text)} is not a valid pattern: ${error.message}`);
  }
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function onlyKeys(value, allowed, where) {
  if (!isObject(value)) throw new Error(`${where} must be an object`);
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new Error(`${where} has unknown keys: ${extra.join(", ")}`);
}

function patterns(value, where, { required }) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new Error(`${where} must be a list of patterns`);
  }
  return value.map((text) => {
    try {
      return compilePattern(text);
    } catch (error) {
      throw new Error(`${where}: ${error.message}`);
    }
  });
}

function oneLine(value, where) {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) {
    throw new Error(`${where} must be a one-line, non-empty string`);
  }
  return value;
}

function compileRule(rule, where) {
  onlyKeys(rule, ["id", "lane", "why", "paths", "except", "inPackage"], where);
  if (typeof rule.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(rule.id)) {
    throw new Error(`${where}.id must be lowercase letters, digits and dashes`);
  }
  if (!LANES.includes(rule.lane)) throw new Error(`${where}.lane must be green, amber or red`);
  oneLine(rule.why, `${where}.why`);
  if (rule.inPackage !== undefined && typeof rule.inPackage !== "boolean") {
    throw new Error(`${where}.inPackage must be true or false`);
  }
  return {
    id: rule.id,
    lane: rule.lane,
    why: rule.why,
    ...(rule.inPackage ? { inPackage: true } : {}),
    paths: patterns(rule.paths, `${where}.paths`, { required: !rule.inPackage }),
    ...(rule.except === undefined ? {} : { except: patterns(rule.except, `${where}.except`, { required: true }) }),
  };
}

function compileSettings(raw) {
  onlyKeys(
    raw,
    ["baseBranch", "node", "install", "test", "runner", "allowedSuppressions", "rules"],
    "The settings",
  );
  const merged = { ...DEFAULTS, ...raw };
  if (!Object.hasOwn(RUNNERS, merged.runner)) {
    throw new Error(`runner must be one of: ${Object.keys(RUNNERS).join(", ")}`);
  }
  if (!Object.hasOwn(raw, "test")) merged.test = defaultTest(merged.runner);
  if (merged.baseBranch !== null) oneLine(merged.baseBranch, "baseBranch");
  for (const key of ["node", "install", "test"]) oneLine(merged[key], key);
  if (!Array.isArray(merged.rules) || merged.rules.length === 0) {
    throw new Error("rules must be a non-empty list");
  }
  const rules = merged.rules.map((rule, index) => compileRule(rule, `rules[${index}]`));
  const ids = rules.map((rule) => rule.id);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index || id === SETUP_RULE.id);
  if (repeated.length > 0) throw new Error(`rule ids must be unique and not ${SETUP_RULE.id}: ${repeated.join(", ")}`);
  if (!Array.isArray(merged.allowedSuppressions)) {
    throw new Error("allowedSuppressions must be a list");
  }
  const allowedSuppressions = merged.allowedSuppressions.map((entry, index) => {
    const where = `allowedSuppressions[${index}]`;
    onlyKeys(entry, ["line", "files"], where);
    return {
      line: patterns([entry.line], `${where}.line`, { required: true })[0],
      ...(entry.files === undefined ? {} : { files: patterns(entry.files, `${where}.files`, { required: true }) }),
    };
  });
  return {
    baseBranch: merged.baseBranch,
    node: merged.node,
    install: merged.install,
    test: merged.test,
    runner: merged.runner,
    allowedSuppressions,
    rules: [compileRule(SETUP_RULE, "the setup rule"), ...rules],
  };
}

function parseSettings(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`it is not valid JSON: ${error.message}`);
  }
  return compileSettings(raw);
}

function readSettings(file) {
  if (!file || !fs.existsSync(file)) return { settings: compileSettings({}), error: null };
  try {
    return { settings: parseSettings(fs.readFileSync(file, "utf8")), error: null };
  } catch (error) {
    return { settings: compileSettings({}), error: error.message };
  }
}

const settingsAt = (root) => readSettings(path.join(root, SETTINGS_FILE));

module.exports = {
  SETTINGS_FILE,
  SETUP_RULE,
  DEFAULT_RULES,
  DEFAULTS,
  defaultTest,
  compilePattern,
  parseSettings,
  readSettings,
  settingsAt,
};
