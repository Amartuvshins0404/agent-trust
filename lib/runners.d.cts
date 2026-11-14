import type { Settings } from "./settings.cjs";

export const RUNNERS: Record<Settings["runner"], { readonly reportArgs: (file: string) => Array<string> }>;
export function testCommand(settings: Settings, reportFile: string, files: ReadonlyArray<string>): string;
export function vitestOwner(cwd: string, test: string): { dir: string; config: string | null };
