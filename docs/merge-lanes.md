# Merge lanes and the outcome ledger

Every pull request into a project's base branch gets one `lane:*` label from the Merge Lane workflow:

- `lane:green`: documentation only.
- `lane:amber`: ordinary code.
- `lane:red`: always a maintainer's call: CI and workflows, dependencies, migrations, auth and secrets, build and test config, text models read, and anything that loosens a gate.

The path rules come from the project's settings file, `.github/agent-trust.json`, or from the defaults in [settings.cjs](../lib/settings.cjs) when the project has none. The content rules (suppressions, skipped and deleted tests, the checks contract) are the same for every project and live in [merge-lane.cjs](../lib/merge-lane.cjs). The job summary of each run explains the lane in plain words.

## Settings

The settings file holds only what differs per project. Every key is optional.

- `rules`: the path rules, each with an `id`, a `lane`, a plain-words `why`, and `paths`. A path is a glob (`**`, `*`, `?`, `{a,b}`) matched against the whole repo-relative path, or a regular expression written `/like this/` with optional `i`. `except` lists paths the rule skips, and `inPackage: true` also covers every workspace package read from `pnpm-workspace.yaml` or the `workspaces` of `package.json`. A file that lists `rules` replaces the defaults entirely, so copy them from [templates/agent-trust.json](../templates/agent-trust.json) and edit.
- `allowedSuppressions`: added suppression lines that do not turn the lane red, each a `line` pattern and optional `files` patterns.
- `install` and `test`: one-line shell commands. Blind Checks runs `install` before each run, and `test` followed by the runner's report flags and the test files, so a JSON report comes out. Defaults: `npm ci`, and `npx vitest run`, or `npx jest` when the runner is Jest.
- `runner`: `vitest` (the default) or `jest`. Each runner's report flags, how it says a test file could not load, and its Stryker hooks are one entry in [runners.cjs](../lib/runners.cjs). For Jest, Blind Checks appends `--ci --json --outputFile=<report> --runTestsByPath` and the test files.
- `node`: the Node version Blind Checks installs. Default `24`.
- `baseBranch`: the branch whose pull requests are judged. Default: the repository's default branch. Pull requests into any other branch are skipped.

The rule `agent-trust-setup` is always on, whatever the settings say: a pull request that edits the settings file or anything under `.github/workflows/` or `.github/actions/` is red, because those decide what judges and runs on pull requests.

A settings file that is not valid JSON, has an unknown key, or has a rule that is incomplete or does not compile is never ignored. The lane bot judges with the defaults and adds a red reason that quotes the error, and Blind Checks stops with that error.

## Pinning the tool version

A project calls the two reusable workflows by a ref, such as `Amartuvshins0404/agent-trust/.github/workflows/blind-checks.yml@v0`. That ref decides which judge, rules engine and test strength code run on the project's pull requests.

- A full commit SHA is the strongest pin: nobody can change what it runs.
- The tag `v0` follows fixes. Only someone who can push tags to the agent-trust repo can move it, so the project trusts that repo's owner.
- Moving the pin means editing a caller file, which is red under `agent-trust-setup`, so it is always the project owner's call.

The lane bot takes the pin from the caller file on the base branch, because `pull_request_target` runs the base branch's workflow. Blind Checks runs on `pull_request`, so its caller file comes from the pull request, which can point it at another ref or another repo. Doing so makes the lane red, as any workflow edit does.

## What is easy to get wrong

- **The base branch judges.** The workflow runs on `pull_request_target`, and again from the base branch when Blind Checks finishes. It checks out only the settings file and the package manifests of the base branch as it is when the job starts, fetches agent-trust at the commit its caller pinned, and reads the PR's files and patches from the GitHub API. It never checks out or runs PR code. A PR that edits the settings is judged by the old settings, so a rule change takes effect only after it merges. It also means the workflow first runs on the PR after the one that adds it.
- **Unknown is red.** A path no rule matches is red, and so is a code file GitHub sends without a patch, since a loosened check cannot be ruled out. The defaults make code and image files amber wherever they are, so only a file they do not know that is not code, such as a new config file, is red as unknown, because config is where a gate gets loosened. When a new directory or config file appears, add a rule for it, or every PR that touches it stays red.
- **It only reports until you switch it on.** Nothing merges, closes or reverts because of the label. With the switch in [Locked checks](#locked-checks-and-repairs-lines) on, the Merge lane check fails on the pull request's own run when the lane is red for any reason except test strength.
- **Suppressions make a change red, except the ones the settings allow.** An added `oxlint-disable`, `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `biome-ignore` or `@effect-diagnostics` line counts as loosening a gate. Only lines that match `allowedSuppressions` pass. A reason on any other suppression changes nothing, because whoever wrote the change can always write one.

Judge any commit, range or working tree locally, from the project's root with a clone of agent-trust next to it:

```sh
node ../agent-trust/lib/merge-lane.cjs HEAD
node ../agent-trust/lib/merge-lane.cjs origin/main..HEAD
node ../agent-trust/lib/merge-lane.cjs --worktree-base origin/main --cwd ../other-worktree
node ../agent-trust/lib/merge-lane.cjs --pr 12 --repo owner/name
```

`--pr` reads the same API data the workflow reads and changes nothing on GitHub.

## Locked checks and Repairs: lines

An agent that writes both the code and its tests proves little when the tests pass. So for amber work, a fresh agent that has seen only the request writes the tests first, the lane bot locks them, and the [Blind Checks](../.github/workflows/blind-checks.yml) job proves they fail without the code and pass with it.

The contract a pull request follows:

- The body has a `## Request` section: the request and any agreed decisions, with no code plan. The checks are judged against it.
- The first commit is the checks commit. It changes only test and test-support files and carries a `Blind-checks: <note>` trailer. When the project's own rules say no test is needed (a visual fix, copy text, types only, a pure refactor), the first commit is empty and says `Blind-checks: none, <reason>`.
- A fix, meaning a title that starts with `fix:` or `fix(scope):`, has a `Repairs:` line naming the commits or merged pull requests on the base branch it repairs, such as `Repairs: 6fceb557b2, #5`, or `Repairs: none, older than 14 days`. Each target must already be in the history the fix was built on. Commit times do not count. This applies in every lane.

Test and test-support files are the paths the ledger already leaves out as tests (`TEST_SUPPORT` in [merge-lane.cjs](../lib/merge-lane.cjs)).

Green pull requests are exempt from the checks rules. A red one gets them only when it has a checks commit, since you read red work anyway. An amber one with no checks commit and no `none` line turns red as "not checked blind". Each broken rule turns the lane red with its own reason. A changed lock also lists each locked test file with its old and new test names, unless that list is too long for one comment.

### What is easy to get wrong

- **The lock is a bot comment.** The first time the lane bot sees a checks commit it saves a fingerprint of it in a comment by `github-actions[bot]`. A comment by anyone else is ignored. The fingerprint covers the trailer and the lines the commit adds and removes, not its SHA, so rebasing onto a newer base branch keeps the lock. Rewriting the commit's content does not.
- **Text typed into the lock comment is fine, and is dropped.** The bot finds its lock anywhere in its own comment before the test strength section, so text above it changes nothing unless it holds one of the bot's own markers, and a file name shown in the strength section cannot plant a lock. Bots on the shared `github-actions[bot]` account find their own comments by a hidden marker, so the lane, strength and size bots hide `<!--` in every file and test name they write (`hideMarkers` in `test-delta.cjs`). A new bot that writes names must do the same. The lane bot's next write rebuilds the comment with the lock first, and the edit history keeps what was typed.
- **A long lock is shortened.** GitHub caps a comment at 65,536 characters. The bot counts bytes against that number, which is safe however GitHub counts, so a long list of non-English test names is shortened sooner. When the test names do not fit, the comment keeps only the checks commit and its fingerprint and says it left the list out. A rewritten checks commit is still caught, but the comment does not say which tests changed.
- **Revising checks is red on purpose.** A later commit with a `Blind-checks:` trailer is a revision, which is red and yours to judge. A later commit that touches a test file without the trailer is red as tampering. Putting a locked test file back as it was counts too.
- **The proof job runs pull request code.** It runs on `pull_request` with read-only contents and no secrets, which is why it is separate from the lane bot. The caller must not pass `secrets: inherit`. The judge comes from agent-trust at the pinned commit, never from the pull request, and the settings, with the install and test commands, come from the base branch as it is when the job starts, not as it was when the pull request was opened. The caller file comes from the pull request, so a pull request can still change the job. Doing so makes the lane red. To fetch a private repo, the job keeps its read-only token in the checkout's git config, as `actions/checkout` does, so pull request code can read that token.
- **The proof learns which tests are new from the test runner's results.** It runs each test file as it was on the base on the base code, as it is at the head on the base code, and at the head with the code. A test file the pull request added has no old run, so it runs only the last two times. A test is new when its describe path and title come up more often with the code than in the old run, so a renamed old test or a renamed `describe` counts as new and must fail without the code. Two tests are the same only when the path and the title are both equal, so a top-level test titled `a > b` is not test `b` inside `describe("a")`. A name that comes up more often without the code than with it did not pass with the code, so its row names it.
- **Every checked test file must show a test that fails without the code.** In a file that loads without the code, at least one test name must fail more often without the code than it did in the old run, or its row says `Nothing in it failed without the code.` So a checks commit that only weakens or reshuffles old tests does not read proven, unless its file cannot load without the code. A test file the pull request leaves as it is on the base is not checked, even when a checks commit changed it and a later commit put it back.
- **A test file that cannot load counts as failing only if it loads with the code.** Without the code, an import of a missing module fails the whole file. The judge accepts that only when the same file loads and passes at the head, because the runs without and with the code both use the test files as they are at the head. A file that fails to load both times is a broken setup. A file that holds no tests without the code, where the test runner says `No test suite found` (Vitest) or `Your test suite must contain at least one test` (Jest), did load and is judged like any other. A file that cannot load hides whether each test in it would have failed on its own.
- **The run with the code uses the files as they are at the head.** After the run without the code the job switches to the head. If git then reports any changed or new file, the job stops with an error and gives no verdict, so a test cannot leave behind a changed file that git sees at the switch. This also stops an honest new test that leaves a temp folder in the repo when it fails, so write temp files to the system temp folder or clean up in `finally`.
- **A test runner can skip a path it does not know.** The judge treats a test file with no result as not run, never as passed.
- **Jest never writes a snapshot here.** Jest runs with `--ci`, so a snapshot test with no stored snapshot fails, with the code too, and no file is written. A snapshot file in the pull request is used in both runs.
- **It reports until you switch it on.** The repository variable `BLIND_CHECKS_MODE=required` makes the Merge lane check fail when the lane is red for any reason except test strength, and makes Blind checks fail when the proof does not hold. Only the pull request's own run can fail. The run after Blind Checks finishes never fails. Any other value only reports. Nothing blocks a merge until both checks are required on the base branch. Once they are required, a red pull request merges only when someone allowed to bypass the branch rule reads it and merges it. Nobody else can merge it.

### What it cannot prove

- That the checks agent was blind. It could read other threads or branches, and the request could carry a code plan.
- That a check failed because of the code. The proof sees only that it failed before the code and passed after it. A check that fails for another reason still reads proven: one that reads the job's own files or the git state, or one that fails only the first time it runs. Test strength below measures whether the tests as a set notice the code, and it only reports until it is switched on.
- That a check did not attack the job. A check runs its own code inside the job. The job looks once, right after the switch, and stops only on file changes that git reports then. A check built to hide a change from git, to change a file after that look, or to rewrite the plan, the reports or the tools, is not stopped.
- That a check is strong. A weak check still passes, such as one that only checks that a file exists.
- That a changed old test is right. A test that keeps its name is old, so its rewritten body is judged only by the rule that something in its file fails without the code. An old test weakened in place is not seen when another test in the same file fails without the code.
- Which of several tests with one full name failed. They are matched by count, and so are long table titles the test runner cuts short. A test whose name holds a value that changes per run reads as new every time.
- That the markers are honest. An agent with the owner's token can write a `Blind-checks:` trailer, edit the bot's comment, remove a label or loosen the ruleset. Each leaves a trail in the commit, the comment's edit history or the audit log, and none of them can be stopped.
- That the code is general. The coder can special-case the test inputs, or change code under `src/` that the tests rely on.
- That the lock came early. A draft pull request opened late lets the lock record checks that were already rewritten.

### Test strength

After the proof, the Blind Checks job breaks the JavaScript and TypeScript lines the pull request changed, one small change at a time, with [Stryker](https://stryker-mutator.io), and runs the tests after each break. The tests are the pull request's test files plus same-name test files next to changed code, in any package. Browser tests are not run. Only breaks that change a decision count; the kinds are `BREAK_WORDING` in [test-strength.cjs](../lib/test-strength.cjs). It works with Vitest only: the project must have `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` as dev dependencies, or the result is not measured. A Jest project is always not measured. A break on a line no test ran counts as not noticed. Above 800 changed code lines it measures an even sample of 800, the same for the same commit, and it stops after 5 minutes.

When Blind Checks finishes, the lane bot reads the measurement as data, judges it again with the base branch's rules, adds a "Test strength" section to its comment, and keeps one label:

- `strength:strong`: the tests noticed every counted break, and at least one was tried.
- `strength:weak`: the tests missed at least one. The section gives the counts and up to 3 examples in fixed wording.
- `strength:unmeasured`: not measured, with the reason: no checks commit, no test needed, no JavaScript or TypeScript changed, only browser tests, the tests failed, Stryker is not installed, the project tests with Jest, no counted break could be made, it ran out of time, or Blind Checks has not finished or left no measurement.

It reports until the repository variable `TEST_STRENGTH_MODE` is `required`. Then weak, and not measured on a pull request that has tests, turn the lane red. A lane that is red only for test strength never fails the Merge lane check, whatever `BLIND_CHECKS_MODE` says.

Measure a change locally from a clean tree, with a checks commit first:

```sh
node ../agent-trust/lib/test-strength.cjs measure --first <checks commit> --base origin/main --head HEAD --out ../strength
```

#### What is easy to get wrong

- **Stryker edits files in place.** It puts them back when it ends or is stopped, and the runner checks `git status` after each run. Its type-check step is off and it reads only the planned files, because that step rewrote files across the repo and lost their exec bits.
- **The runner never passes Stryker's `testFiles` option.** In 10.1.1 it makes a break in code that runs while a file loads, such as a pattern at the top of a file, look unnoticed. The runner narrows each package's own test config (the nearest `vitest.config.*`, or `vite.config.*` with a `test` section) to the chosen tests instead, with one Stryker run per config.

#### What it cannot prove

- That the code does what the request asked. It checks that the tests pin the code's decisions, not that the decisions are right.
- What is missing. It only breaks code that exists, so a missing guard or case shows nothing.
- That a missed break matters. About 1 in 4 counted breaks change nothing real (32 checked by hand).
- That the measurement is honest. Pull request code runs in the job that writes it, so it can notice Stryker and fail on purpose, or overwrite the file. The bot shows only counts, paths and fixed wording, but cannot spot a forged count.
- Logic kept in data files, other languages or test-support paths, which it never breaks. Tests that snapshot whole outputs notice every break and look strong while being brittle.

## Outcome ledger

The ledger measures which merged changes later needed repair. It reads only git history, and PR labels when you pass `--repo`.

```sh
node ../agent-trust/lib/merge-ledger.ts --branch origin/main --repo owner/name --out ../ledger
node ../agent-trust/lib/merge-ledger.ts --branch origin/main --since "30 days ago"
```

A change escaped when a later commit reverts it, or when a later `fix` commit within `--window` days (default 14) rewrites code it wrote. The ledger runs `git blame -w -M -C` on the fix's parent over the code lines the fix changes or deletes, and links the fix to a change only when that change wrote at least half of those lines. Blank and comment-only lines, tests, docs, lockfiles, generated files and vendored `.repos/` are left out. Lanes come from the settings file in `--cwd` (default: the current directory). When several later commits count as escapes of one change, the report keeps one, and its days to the fix: a revert over a fix, then the closest in time, then the lowest commit id. Escape rates count only changes whose window has passed. Thirty days of upstream history take under two minutes.

A fix with a `Repairs:` line, read from the pull request body with `--repo` or from the commit message, is linked to the changes the line names, and blame is only a cross-check. The report lists each fix where the two disagree. Read a disagreement as a reason to look, not as proof that the line is wrong: blame misses fixes that only add lines. The "By checks" table splits merges into checked blind, none needed, checks revised and no checks. Merges from before the contract have no trailer and count as no checks.

**How far to trust it.** These figures were measured on t3code's history, not on yours. Against 60 upstream fixes labelled by hand and kept out of tuning (2026-11-12), 4 of the ledger's 13 links were right, and it found 4 of the 8 fixes that repaired a change from the previous 14 days. On the 59 fixes the rules were tuned on it did better, 5 of 11 and 5 of 7, which is why the kept-back half is the one to quote. Most of the escapes it lists are wrong, and it counts about 1.6 times as many recent repairs as hand reading. The report also gives the share of fix commits linked to a recent change, the figure to compare with hand reading, where 15 of 120 upstream fixes (12.5%) repaired one. With 8 recent repairs behind the figures, a rate is rough: trust a gap between two lanes or areas only when it is large and both have many mature merges.

What blame cannot do, whatever the rules:

- A fix whose lines a recent change last wrote looks like a repair of that change, even when the fault is older or the fix is polish. This causes most of the wrong links that remain.
- A fix that only adds lines, such as a missing guard or case, links to nothing.
- A fix that repairs code older than the window is not counted, by design.
- Without `--repo`, lanes are recomputed with today's rules, not the label the change had when it merged.

### Checking a rule change

`--score <labels.json>` adds a section that compares the ledger's links with hand labels: link precision and recall, how many labelled recent repairs it found, and how many fixes it counts as recent repairs against the labelled count, each with the numbers behind it. The labels file holds `{ "records": [{ "fix", "kind", "culprits" }] }`, where `kind` is `repair-recent`, `repair-old`, `not-repair` or `unsure`, and `culprits` are the full SHAs of the changes the fix repairs. Run it over a range that starts at least 14 days before the oldest labelled fix, or the culprits are not in the list:

```sh
node ../agent-trust/lib/merge-ledger.ts --branch ee90bdc9405d8d4b8ff78ce2133ccb04844298ab --since 2026-09-28 --until 2026-11-12T09:18:38Z --score labels.json
```

A new rule has to hold for fixes nobody labelled. Keep half the labels out of tuning and score the rule on them before you trust it. When the figures change, update the "How sure" text in `lib/merge-ledger.ts` and this section.
