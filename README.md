# agent-trust

Helps you decide which pull requests you can merge without reading them, when an agent wrote the code.

It adds two checks to a GitHub repo:

- **Merge Lane** labels every pull request `lane:green`, `lane:amber` or `lane:red` from the paths it changes and what its patches add. Green is documentation. Amber is ordinary code. Red is always your call: CI and workflows, dependencies, migrations, auth and secrets, build and test config, text that AI models read, and anything that silences a check or skips or deletes a test.
- **Blind Checks** proves that the tests in the pull request's first commit fail without the code and pass with it. Then it breaks the changed code on purpose, one small change at a time, to see whether the tests notice (`strength:strong`, `strength:weak` or `strength:unmeasured`).

Both only report until you switch them on with the repository variables `BLIND_CHECKS_MODE=required` and `TEST_STRENGTH_MODE=required`. Nothing merges, closes or reverts because of a label.

## Set it up

From the root of the project's repo, with Node and a signed-in [GitHub CLI](https://cli.github.com):

```sh
npx -y github:Amartuvshins0404/agent-trust#v0 setup
```

It looks at the project and writes only what it needs:

- `.github/workflows/merge-lane.yml`, always.
- `.github/workflows/blind-checks.yml`, when the project tests with Vitest or Jest. A project with another runner, bun, no tests, or no `package.json` gets lane labels only, and the command says why.
- `.github/agent-trust.json`, only when the defaults are wrong for the project, such as with Jest, pnpm or Yarn.

It makes the `lane:*` and `strength:*` labels with `gh`. It never sets `BLIND_CHECKS_MODE` or `TEST_STRENGTH_MODE`, so both bots only report. It does not commit, push or open a pull request. Commit the files, open one pull request into the default branch and merge it. The lane bot judges the pull requests after that one.

Running it again changes nothing. It never overwrites a file it did not write: if a workflow with one of the two names is someone else's, it stops and writes nothing.

- `setup --protect` adds a ruleset named `agent-trust` that requires the checks on the default branch. Run it after the setup pull request merged. A private repo on GitHub's free plan cannot require checks; the command says so and changes nothing.
- `setup --remove` deletes the files it wrote and the `agent-trust` ruleset, and leaves the labels.

Agents can follow [skills/agent-trust-setup/SKILL.md](skills/agent-trust-setup/SKILL.md).

## What a project adds

1. `.github/workflows/merge-lane.yml`, copied from [templates/merge-lane.yml](templates/merge-lane.yml).
2. `.github/workflows/blind-checks.yml`, copied from [templates/blind-checks.yml](templates/blind-checks.yml).
3. Optional: `.github/agent-trust.json`, copied from [templates/agent-trust.json](templates/agent-trust.json) and edited. Without it, the defaults apply: Vitest, `npm ci` to install, `npx vitest run` to test, and the default path rules. A Jest project sets `"runner": "jest"`, which tests with `npx jest`.

Keep the two workflow file names: other tools look for `.github/workflows/blind-checks.yml`. For test strength on a Vitest project, add `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` as dev dependencies. Test strength does not measure Jest projects.

Each pull request then needs a `## Request` section in its body and a first commit that adds only tests and carries a `Blind-checks: <note>` trailer, or an empty first commit that says `Blind-checks: none, <reason>`. A fix also needs a `Repairs:` line. [docs/merge-lanes.md](docs/merge-lanes.md) has the full contract.

The caller files pin a version of this repo, `@v0` in the templates. Pin a full commit SHA if you want a judge nobody else can move. Moving the pin is a red pull request. See [Pinning the tool version](docs/merge-lanes.md#pinning-the-tool-version).

## The settings file

It holds only what differs per project: the path rules (each with an id, a lane and a plain-words reason), the suppression lines you allow, the install and test commands, the test runner, the Node version and the base branch. A file that lists rules replaces the default rules entirely. A broken settings file is never ignored: every pull request turns red and the reason quotes the error.

Editing the settings file, or anything under `.github/workflows/` or `.github/actions/`, is always red.

[examples/t3code/agent-trust.json](examples/t3code/agent-trust.json) is the set of rules this tool started with in t3code. It gives the same lane as those built-in rules on all 7,957 paths in t3code's tree, which `test/settings.test.ts` checks. Its install and test commands have not been tried.

## What it cannot prove

- That the agent that wrote the tests was blind. It could read other threads or branches, and the request could carry a code plan.
- That a test failed because of the code. It only sees that the test failed before the code and passed after it.
- That a test is strong, or that the code does what the request asked. Test strength only checks that the tests notice changes to decisions the code makes, and about 1 in 4 of the breaks it counts make no real difference.
- That the pull request did not attack the job. Blind Checks runs pull request code, which can hide changes from git or forge the strength measurement.
- That the markers are honest. Anyone with the owner's token can write a trailer, edit the bot's comment, remove a label or loosen the branch rules. Each leaves a trail.
- What is missing. A missing guard or case shows nothing.

## What does not work yet

- Test strength measures Vitest projects only. On a Jest project it says "not measured". Stryker's Jest runner needs its own way to narrow the run to the chosen tests, and presets such as `jest-expo` need their test environment wrapped by Stryker; neither has been built or tried.
- Tried on one more project so far: a private npm and Vitest repo, set up with `setup`. The lane bot labeled and locked a pull request, Blind Checks installed, ran, judged it proven, and the lane bot ran again after it. Test strength said not measured there, since that project has no Stryker; a real strength measurement has only run in t3code.
- `setup --protect` has only been refused (a private repo on the free plan). Creating the ruleset has not been tried on a real repo.
- Browser tests are not run by test strength, and nothing sets up browsers for you. Put that in your install command.
- The tool repo must stay public: the workflows fetch it without a token.

## Develop

```sh
npm ci
npm test
```

Judge a commit of any project from its root: `node ../agent-trust/lib/merge-lane.cjs HEAD`.
