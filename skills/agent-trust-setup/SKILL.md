---
name: agent-trust-setup
description: Set up, check or remove agent-trust (merge lane labels and Blind Checks) on a GitHub repo. Use when asked to add agent-trust, merge lanes, lane labels or blind checks to a project, or to take them out again.
---

# Set up agent-trust on a project

agent-trust labels each pull request `lane:green`, `lane:amber` or `lane:red`, and on JavaScript or TypeScript projects that test with Vitest it proves that the tests in a pull request's first commit fail without the code and pass with it. It only reports until the owner switches it on.

## When to use

- The owner asks to add agent-trust, merge lanes or blind checks to a repo.
- The owner asks to take it out again.

Do not use it to switch the bots on (`BLIND_CHECKS_MODE`, `TEST_STRENGTH_MODE`). That is the owner's call.

## Set up

1. Start from an up-to-date default branch, on a new branch, with a clean tree:

   ```sh
   git fetch origin
   git switch -c chore/agent-trust-setup origin/<default branch>
   ```

2. Run the command from the repo root. It needs Node and a signed-in `gh` (`gh auth status`).

   ```sh
   npx -y github:Amartuvshins0404/agent-trust#v0 setup
   ```

   It writes `.github/workflows/merge-lane.yml`, and `.github/workflows/blind-checks.yml` when the project tests with Vitest. It writes `.github/agent-trust.json` only when the defaults (`npm ci`, `npx vitest run`) are wrong for the project. It makes the labels. It does not commit, push or open a pull request. Read what it prints.

3. If it stops because a workflow with one of the two names already exists and is not agent-trust's, tell the owner. Do not rename or delete their workflow yourself.

4. Check the settings, when Blind Checks was added. Open `.github/agent-trust.json`, or read the printed commands if no file was written:
   - `install` must install everything the tests need on a clean Linux machine, from the lockfile. Add browser or system setup here if the tests need it.
   - `test` must run Vitest once, not in watch mode, so that report flags and test file paths can be appended to it. A command that runs other tools after Vitest (`vitest run && tsc`) is wrong here.
   - `node` defaults to `24`. Set it if the project needs another version.
   - Try the commands locally: run `install`, then `test` with one test file after it.

5. Open the one setup pull request into the default branch. Its diff must hold only the files the command wrote under `.github/`.

   ```sh
   git add .github
   git commit -m "ci: add agent-trust merge lanes and blind checks"
   git push -u origin HEAD
   gh pr create --base <default branch> --title "ci: add agent-trust merge lanes and blind checks" --body "Adds the agent-trust caller workflows. They only report."
   ```

6. After it merges, the lane bot judges every pull request opened or updated from then on. Pull requests then follow the contract in [docs/merge-lanes.md](../../docs/merge-lanes.md): a `## Request` section in the body, and a first commit with only tests and a `Blind-checks:` trailer.

7. Optional, only if the owner asks: `npx -y github:Amartuvshins0404/agent-trust#v0 setup --protect` after the setup pull request merged. It adds a ruleset named `agent-trust` that requires the checks on the default branch.

Running the command again changes nothing.

## Remove

```sh
npx -y github:Amartuvshins0404/agent-trust#v0 setup --remove
```

It deletes the two caller files when they call agent-trust, the settings file, and the `agent-trust` ruleset if `--protect` made one. It leaves the labels. Commit the deletions and merge them in one pull request.

## Honest limits

- A private repo on GitHub's free plan cannot require checks. `--protect` says so and changes nothing; the labels still work.
- A project with no tests, with Jest or another runner, with bun, or that is not JavaScript or TypeScript, gets lane labels only. Its amber pull requests still need a checks commit or an empty `Blind-checks: none, <reason>` first commit, or they turn red.
- The lane bot first judges the pull request after the one that adds it, because it runs from the default branch.
- Test strength says "not measured" until `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` are dev dependencies.
- The callers pin `@v0`, a tag the agent-trust owner can move. Pin a full commit SHA for a judge nobody else can move.
