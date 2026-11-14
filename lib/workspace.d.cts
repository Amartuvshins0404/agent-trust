interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
}

export function readWorkspace(root?: string): Array<WorkspacePackage>;
