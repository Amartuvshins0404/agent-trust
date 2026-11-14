import type { Settings } from "./settings.cjs";

export const RUNNERS: Record<
  Settings["runner"],
  {
    readonly command: string;
    readonly reportArgs: (file: string) => Array<string>;
    readonly loadFailure: (message: string | undefined) => { line: string; empty: boolean };
  }
>;
export function testCommand(settings: Settings, reportFile: string, files: ReadonlyArray<string>): string;
export function vitestOwner(cwd: string, test: string): { dir: string; config: string | null };
