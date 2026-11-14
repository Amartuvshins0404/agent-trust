export type Reader = (file: string) => string | null;

export type Project =
  | { readonly js: false }
  | {
      readonly js: true;
      readonly manager: "npm" | "pnpm" | "yarn" | "bun";
      readonly lockfile: string | null;
      readonly yarnBerry: boolean;
      readonly runner: "vitest" | "jest" | "other" | "none";
      readonly script: string;
      readonly stryker: boolean;
    };

export type Proof =
  | { readonly install: string; readonly test: string; readonly why?: undefined }
  | { readonly why: string };

export interface SetupPlan {
  readonly project: Project;
  readonly proof: Proof;
  readonly blocked: ReadonlyArray<string>;
  readonly write: ReadonlyArray<{ readonly file: string; readonly content: string }>;
  readonly kept: ReadonlyArray<string>;
}

export declare const CALLERS: ReadonlyArray<string>;
export declare const LABELS: ReadonlyArray<{ name: string; color: string; description: string }>;
export declare function readTemplates(dir?: string): Readonly<Record<string, string>>;
export declare function detectProject(read: Reader): Project;
export declare function planSetup(read: Reader, templates?: Readonly<Record<string, string>>): SetupPlan;
export declare function planRemove(read: Reader): {
  readonly remove: ReadonlyArray<string>;
  readonly kept: ReadonlyArray<string>;
};
export declare function main(args: ReadonlyArray<string>, options?: { cwd?: string; say?: (line: string) => void }): number;
