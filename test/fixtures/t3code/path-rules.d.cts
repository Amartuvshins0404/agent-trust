export function pathRulesFor(
  file: string,
  packageDirs: ReadonlyArray<string>,
): ReadonlyArray<{ readonly id: string; readonly lane: "green" | "amber" | "red" }>;
