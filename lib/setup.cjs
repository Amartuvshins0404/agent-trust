const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { LANE_MEANING, STRENGTH_LABEL_LOOK } = require("./merge-lane.cjs");
const { DEFAULTS, SETTINGS_FILE } = require("./settings.cjs");

const TEMPLATES = path.join(__dirname, "..", "templates");
const TOOL_WORKFLOWS = "Amartuvshins0404/agent-trust/.github/workflows/";
const LANE_CALLER = ".github/workflows/merge-lane.yml";
const PROOF_CALLER = ".github/workflows/blind-checks.yml";
const CALLERS = [LANE_CALLER, PROOF_CALLER];
const RULESET = "agent-trust";
const ACTIONS_APP = 15368;
const CHECK_NAMES = { [LANE_CALLER]: "lane / Merge lane", [PROOF_CALLER]: "proof / Blind checks" };
const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];
const LANE_COLORS = { green: "1f883d", amber: "d4a72c", red: "d1242f" };
const LABELS = [
  ...Object.entries(LANE_MEANING).map(([lane, meaning]) => ({
    name: `lane:${lane}`,
    color: LANE_COLORS[lane],
    description: `Merge lane: ${meaning}`,
  })),
  ...Object.entries(STRENGTH_LABEL_LOOK).map(([name, look]) => ({ name, ...look })),
];

function readTemplates(dir = TEMPLATES) {
  return Object.fromEntries(
    CALLERS.map((file) => [file, fs.readFileSync(path.join(dir, path.basename(file)), "utf8")]),
  );
}

function detectProject(read) {
  const manifest = read("package.json");
  if (manifest === null) return { js: false };
  let pkg;
  try {
    pkg = JSON.parse(manifest);
  } catch (error) {
    throw new Error(`package.json is not valid JSON: ${error.message}`);
  }
  const [lockfile, manager] = LOCKFILES.find(([file]) => read(file) !== null) ?? [null, "npm"];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const script = typeof pkg.scripts?.test === "string" ? pkg.scripts.test : "";
  const runner = /\bvitest\b/.test(script)
    ? "vitest"
    : /\bjest\b/.test(script)
      ? "jest"
      : Object.hasOwn(deps, "vitest")
        ? "vitest"
        : Object.hasOwn(deps, "jest")
          ? "jest"
          : script !== "" && !/no test specified/.test(script)
            ? "other"
            : "none";
  return {
    js: true,
    manager,
    lockfile,
    yarnBerry: manager === "yarn" && read(".yarnrc.yml") !== null,
    runner,
    script,
    stryker: Object.hasOwn(deps, "@stryker-mutator/core") && Object.hasOwn(deps, "@stryker-mutator/vitest-runner"),
  };
}

function proofCommands(project) {
  if (!project.js) {
    return { why: "This is not a JavaScript or TypeScript project, so it gets lane labels only." };
  }
  if (project.runner === "none") {
    return { why: "This project has no tests, so it gets lane labels only." };
  }
  if (project.runner !== "vitest") {
    const name = project.runner === "jest" ? "Jest" : `the test script "${project.script}"`;
    return { why: `Locked tests are not supported for ${name} yet, so it gets lane labels only.` };
  }
  switch (project.manager) {
    case "npm":
      return project.lockfile
        ? { install: "npm ci", test: "npx vitest run" }
        : { install: "npm install", test: "npx vitest run" };
    case "pnpm":
      return { install: "corepack enable && pnpm install --frozen-lockfile", test: "pnpm exec vitest run" };
    case "yarn":
      return {
        install: `corepack enable && yarn install ${project.yarnBerry ? "--immutable" : "--frozen-lockfile"}`,
        test: "yarn vitest run",
      };
    default:
      return { why: `Locked tests are not supported with ${project.manager} yet, so it gets lane labels only.` };
  }
}

const callsTool = (file, text) =>
  text.includes(`${TOOL_WORKFLOWS}${path.basename(file)}@`);

function planSetup(read, templates = readTemplates()) {
  const project = detectProject(read);
  const proof = proofCommands(project);
  const blocked = CALLERS.filter((file) => {
    const text = read(file);
    return text !== null && !callsTool(file, text);
  });
  const plan = { project, proof, blocked, write: [], kept: [] };
  if (blocked.length > 0) return plan;
  const wanted = [LANE_CALLER, ...(proof.why ? [] : [PROOF_CALLER])].map((file) => [file, templates[file]]);
  const settings = {};
  if (!proof.why) {
    if (proof.install !== DEFAULTS.install) settings.install = proof.install;
    if (proof.test !== DEFAULTS.test) settings.test = proof.test;
  }
  if (Object.keys(settings).length > 0) {
    wanted.push([SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`]);
  }
  for (const [file, content] of wanted) {
    const current = read(file);
    if (current === null) plan.write.push({ file, content });
    else if (current !== content) plan.kept.push(file);
  }
  return plan;
}

function planRemove(read) {
  const remove = [];
  const kept = [];
  for (const file of CALLERS) {
    const text = read(file);
    if (text === null) continue;
    (callsTool(file, text) ? remove : kept).push(file);
  }
  if (read(SETTINGS_FILE) !== null) remove.push(SETTINGS_FILE);
  return { remove, kept };
}

function failure(error) {
  if (error.code === "ENOENT") return "The GitHub CLI (gh) is not installed. Install it, run gh auth login, then run this again.";
  const text = `${error.stderr ?? ""}`.trim() || error.message;
  return text.split("\n").find((line) => line.trim() !== "") ?? text;
}

const refusedForPlan = (text) => /Upgrade to GitHub Pro|make this repository public/i.test(text);

function makeGh(root) {
  return (args, input) =>
    execFileSync("gh", args, {
      cwd: root,
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
    });
}

function repoInfo(gh) {
  return JSON.parse(gh(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]));
}

function makeLabels(gh, say) {
  const have = new Set(JSON.parse(gh(["label", "list", "--json", "name", "--limit", "1000"])).map((label) => label.name));
  const missing = LABELS.filter((label) => !have.has(label.name));
  for (const label of missing) {
    gh(["label", "create", label.name, "--color", label.color, "--description", label.description]);
  }
  say(
    missing.length > 0
      ? `Made labels: ${missing.map((label) => label.name).join(", ")}.`
      : "Labels: all there already.",
  );
}

function findRuleset(gh, repo) {
  const rulesets = JSON.parse(gh(["api", `repos/${repo.nameWithOwner}/rulesets`]));
  return rulesets.find((ruleset) => ruleset.name === RULESET) ?? null;
}

function protect(gh, repo, say) {
  const branch = repo.defaultBranchRef.name;
  if (findRuleset(gh, repo)) {
    say(`Protect: the "${RULESET}" ruleset already exists, nothing changed.`);
    return 0;
  }
  const onBranch = CALLERS.filter((file) => {
    try {
      gh(["api", `repos/${repo.nameWithOwner}/contents/${file}?ref=${encodeURIComponent(branch)}`]);
      return true;
    } catch {
      return false;
    }
  });
  if (!onBranch.includes(LANE_CALLER)) {
    say(`Protect: skipped. The workflows are not on ${branch} yet. Merge the setup pull request first, then run this again with --protect.`);
    return 0;
  }
  const ruleset = {
    name: RULESET,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" }],
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: onBranch.map((file) => ({ context: CHECK_NAMES[file], integration_id: ACTIONS_APP })),
        },
      },
    ],
  };
  gh(["api", "-X", "POST", `repos/${repo.nameWithOwner}/rulesets`, "--input", "-"], JSON.stringify(ruleset));
  say(`Protect: ${branch} now requires ${onBranch.map((file) => `"${CHECK_NAMES[file]}"`).join(" and ")} (ruleset "${RULESET}"). Admins can still merge a pull request that fails them.`);
  return 0;
}

function unprotect(gh, repo, say) {
  const ruleset = findRuleset(gh, repo);
  if (!ruleset) return;
  gh(["api", "-X", "DELETE", `repos/${repo.nameWithOwner}/rulesets/${ruleset.id}`]);
  say(`Removed the "${RULESET}" ruleset, so no check is required by this tool any more.`);
}

function githubStep(name, say, step) {
  try {
    return step() ?? 0;
  } catch (error) {
    const why = failure(error);
    if (refusedForPlan(why)) {
      say(`${name}: GitHub refused. This repo is private on the free plan, which cannot require checks ("${why}"). The lane labels still work. Nothing was changed.`);
      return 0;
    }
    say(`${name}: not done. ${why}`);
    return 1;
  }
}

function setup(root, { protect: wantProtect, gh, say }) {
  const read = readerAt(root);
  const plan = planSetup(read);
  if (plan.blocked.length > 0) {
    for (const file of plan.blocked) {
      say(`Stopped: ${file} already exists and is not agent-trust's. Nothing was written. Rename that workflow, then run this again.`);
    }
    return 1;
  }
  for (const { file, content } of plan.write) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
    say(`Wrote ${file}`);
  }
  for (const file of plan.kept) say(`Kept ${file} as it is: it is already there and differs from what setup would write.`);
  if (plan.write.length === 0 && plan.kept.length === 0) say("Files: all there already, nothing changed.");
  if (plan.proof.why) say(plan.proof.why);
  else {
    say(`Blind Checks will install with "${plan.proof.install}" and test with "${plan.proof.test}".`);
    if (!plan.project.stryker) {
      say("Test strength will say \"not measured\" until @stryker-mutator/core and @stryker-mutator/vitest-runner are dev dependencies.");
    }
  }
  let code = 0;
  let repo = null;
  try {
    repo = repoInfo(gh);
    makeLabels(gh, say);
  } catch (error) {
    say(`Labels: not made (${failure(error)}). The bots make missing labels themselves, in grey.`);
  }
  if (wantProtect) {
    code = repo
      ? githubStep("Protect", say, () => protect(gh, repo, say))
      : (say("Protect: not done, because the GitHub repo could not be read."), 1);
  }
  say("");
  say("The bots only report. Nothing blocks a merge until you set BLIND_CHECKS_MODE=required and require the checks.");
  if (plan.write.length > 0) {
    say("Next: commit these files on a new branch, open one pull request into the default branch and merge it.");
    say("The lane bot judges pull requests opened or updated after that merge, not the setup pull request itself.");
  }
  return code;
}

function remove(root, { gh, say }) {
  const plan = planRemove(readerAt(root));
  for (const file of plan.remove) {
    fs.rmSync(path.join(root, file));
    say(`Deleted ${file}`);
  }
  for (const file of plan.kept) say(`Left ${file}: it is not agent-trust's.`);
  if (plan.remove.length === 0) say("Files: nothing of agent-trust's here.");
  try {
    unprotect(gh, repoInfo(gh), say);
  } catch (error) {
    const why = failure(error);
    if (!refusedForPlan(why)) say(`Ruleset: could not check for an "${RULESET}" ruleset (${why}).`);
  }
  say("Left the lane:* and strength:* labels and the labels on pull requests. Delete them with gh label delete if you want.");
  if (plan.remove.length > 0) say("Next: commit the deletions and merge them like any change.");
  return 0;
}

function readerAt(root) {
  return (file) => {
    const full = path.join(root, file);
    return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
  };
}

const USAGE = "Usage: agent-trust setup [--protect] [--remove]";

function main(args, { cwd = process.cwd(), say = console.log } = {}) {
  const [command, ...flags] = args;
  const known = ["--protect", "--remove"];
  if (command !== "setup" || flags.some((flag) => !known.includes(flag))) {
    say(USAGE);
    return 1;
  }
  let root;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    say("Run this inside a git repository.");
    return 1;
  }
  const gh = makeGh(root);
  try {
    return flags.includes("--remove")
      ? remove(root, { gh, say })
      : setup(root, { protect: flags.includes("--protect"), gh, say });
  } catch (error) {
    say(`Stopped: ${error.message}`);
    return 1;
  }
}

module.exports = { CALLERS, LABELS, detectProject, planSetup, planRemove, readTemplates, main };
