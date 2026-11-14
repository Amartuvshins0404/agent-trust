# agent-trust

Helps you decide which pull requests you can merge without reading them, when an agent wrote the code.

It adds two checks to a GitHub repo:

- **Merge Lane** labels every pull request `lane:green`, `lane:amber` or `lane:red` from the paths it changes and what its patches add. Green is documentation. Amber is ordinary code. Red is always your call: CI and workflows, dependencies, migrations, auth and secrets, build and test config, text that AI models read, and anything that silences a check or skips or deletes a test.
- **Blind Checks** proves that the tests in the pull request's first commit fail without the code and pass with it. Then it breaks the changed code on purpose, one small change at a time, to see whether the tests notice (`strength:strong`, `strength:weak` or `strength:unmeasured`).

Both only report until you switch them on with the repository variables `BLIND_CHECKS_MODE=required` and `TEST_STRENGTH_MODE=required`. Nothing merges, closes or reverts because of a label.

## What a project adds

1. `.github/workflows/merge-lane.yml`, copied from [templates/merge-lane.yml](templates/merge-lane.yml).
2. `.github/workflows/blind-checks.yml`, copied from [templates/blind-checks.yml](templates/blind-checks.yml).
3. Optional: `.github/agent-trust.json`, copied from [templates/agent-trust.json](templates/agent-trust.json) and edited. Without it, the defaults apply: `npm ci` to install, `npx vitest run` to test, and the default path rules.

Keep the two workflow file names: other tools look for `.github/workflows/blind-checks.yml`. For test strength, add `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` as dev dependencies.

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

- Only Vitest. Jest is the next step: one more entry in [lib/runners.cjs](lib/runners.cjs).
- No setup command. You copy the files by hand.
- Not tried on a second project yet. The lane bot's reusable workflow has not run on a real pull request outside the unit tests.
- Browser tests are not run by test strength, and nothing sets up browsers for you. Put that in your install command.
- The tool repo must stay public: the workflows fetch it without a token.

## Develop

```sh
npm ci
npm test
```

Judge a commit of any project from its root: `node ../agent-trust/lib/merge-lane.cjs HEAD`.
