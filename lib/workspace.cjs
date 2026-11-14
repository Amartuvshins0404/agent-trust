const fs = require("node:fs");
const path = require("node:path");

function workspacePatterns(root) {
  const pnpm = path.join(root, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpm)) {
    const patterns = [];
    let inPackages = false;
    for (const line of fs.readFileSync(pnpm, "utf8").split("\n")) {
      if (/^\S/.test(line)) inPackages = line.startsWith("packages:");
      const entry = inPackages && line.match(/^\s+-\s+["']?([^"'\s]+)/);
      if (entry) patterns.push(entry[1]);
    }
    return patterns;
  }
  const manifest = path.join(root, "package.json");
  if (!fs.existsSync(manifest)) return [];
  const workspaces = JSON.parse(fs.readFileSync(manifest, "utf8")).workspaces;
  const list = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
  return Array.isArray(list) ? list.filter((entry) => typeof entry === "string") : [];
}

function readWorkspace(root = process.cwd()) {
  const dirs = workspacePatterns(root).flatMap((pattern) => {
    if (pattern.startsWith("!")) return [];
    if (!pattern.endsWith("/*")) return [pattern.replace(/\/$/, "")];
    const parent = pattern.slice(0, -2);
    if (!fs.existsSync(path.join(root, parent))) return [];
    return fs.readdirSync(path.join(root, parent)).map((name) => `${parent}/${name}`);
  });

  const packages = [];
  for (const dir of dirs) {
    const manifestPath = path.join(root, dir, "package.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    packages.push({ name: manifest.name, dir });
  }
  return packages;
}

module.exports = { readWorkspace };
