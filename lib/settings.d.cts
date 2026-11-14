import type { Lane } from "./merge-lane.cjs";

export interface RawRule {
  readonly id: string;
  readonly lane: Lane;
  readonly why: string;
  readonly paths?: ReadonlyArray<string>;
  readonly except?: ReadonlyArray<string>;
  readonly inPackage?: boolean;
}

export interface PathRule {
  readonly id: string;
  readonly lane: Lane;
  readonly why: string;
  readonly paths: ReadonlyArray<RegExp>;
  readonly except?: ReadonlyArray<RegExp>;
  readonly inPackage?: true;
}

export interface Settings {
  readonly baseBranch: string | null;
  readonly node: string;
  readonly install: string;
  readonly test: string;
  readonly runner: "vitest";
  readonly allowedSuppressions: ReadonlyArray<{
    readonly line: RegExp;
    readonly files?: ReadonlyArray<RegExp>;
  }>;
  readonly rules: ReadonlyArray<PathRule>;
}

export interface SettingsRead {
  readonly settings: Settings;
  readonly error: string | null;
}

export const SETTINGS_FILE: string;
export const SETUP_RULE: RawRule;
export const DEFAULT_RULES: ReadonlyArray<RawRule>;
export const DEFAULTS: {
  readonly baseBranch: null;
  readonly node: string;
  readonly install: string;
  readonly test: string;
  readonly runner: "vitest";
  readonly allowedSuppressions: ReadonlyArray<never>;
  readonly rules: ReadonlyArray<RawRule>;
};
export function compilePattern(text: string): RegExp;
export function parseSettings(text: string): Settings;
export function readSettings(file: string | null): SettingsRead;
export function settingsAt(root: string): SettingsRead;
