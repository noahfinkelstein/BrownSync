import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const THIS_FILE = resolve(import.meta.filename);
const forbiddenTerms = [["side", "chat"].join(""), ["red", "dit"].join("")];

const explicitFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "db/migrations/0015_board.sql",
  "db/checks/0015_board_checks.sql",
  "db/checks/0015_board_race.sh",
];

const implementationRoots = [".github/workflows", "apps", "packages", "scripts"];

const sourceExtensions = new Set([
  ".cjs",
  ".js",
  ".json",
  ".mjs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

function implementationFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) {
    const name = path.slice(path.lastIndexOf("/"));
    const extension = path.slice(path.lastIndexOf("."));
    return sourceExtensions.has(extension) ||
      name === "/Package.swift" ||
      name === "/project.pbxproj"
      ? [path]
      : [];
  }
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (
      entry.name === "docs" ||
      entry.name === ".superpowers" ||
      entry.name === "dist" ||
      entry.name === "node_modules" ||
      entry.name === ".build"
    ) {
      return [];
    }
    return implementationFiles(join(path, entry.name));
  });
}

describe("G6 native-board boundary", () => {
  it("contains neither prohibited integration family anywhere in the implementation surface", () => {
    const files = [
      ...explicitFiles.map((path) => resolve(REPO_ROOT, path)),
      ...implementationRoots.flatMap((path) => implementationFiles(resolve(REPO_ROOT, path))),
    ].filter(
      (path, index, all) => path !== THIS_FILE && all.indexOf(path) === index && existsSync(path),
    );

    const collisions = files.flatMap((path) => {
      const relativePath = relative(REPO_ROOT, path);
      const content = `${relativePath}\n${readFileSync(path, "utf8")}`.toLowerCase();
      return forbiddenTerms
        .filter((term) => content.includes(term))
        .map((term) => `${relativePath}:${term}`);
    });

    expect(collisions).toEqual([]);
  });
});
