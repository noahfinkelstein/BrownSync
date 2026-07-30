import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../../..");
const generatorURL = pathToFileURL(path.join(repositoryRoot, "scripts/gen-swift-tokens.mjs"));
const generatedTokensPath = path.join(repositoryRoot, "apps/ios/Generated/Tokens.swift");

test("Swift token string literals are safe and importable", async (suite) => {
  await suite.test("importing the generator does not rewrite Tokens.swift", async () => {
    const before = await stat(generatedTokensPath, { bigint: true });
    const imported = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `await import(${JSON.stringify(generatorURL.href)})`],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.equal(imported.status, 0, imported.stderr);
    const after = await stat(generatedTokensPath, { bigint: true });
    assert.equal(after.mtimeNs, before.mtimeNs);
  });

  const { parseTokensSource, renderSwiftTokens, swiftStringLiteral } = await import(
    generatorURL.href
  );

  await suite.test("uses Swift escapes for quotes, backslashes, controls, and Unicode", () => {
    assert.equal(
      swiftStringLiteral('quote: " backslash: \\'),
      String.raw`"quote: \" backslash: \\"`,
    );
    assert.equal(
      swiftStringLiteral("\t\n\r\b\f\0\u0001\u001F\u007F"),
      String.raw`"\t\n\r\u{8}\u{C}\0\u{1}\u{1F}\u{7F}"`,
    );
    assert.equal(
      swiftStringLiteral("\u00E9\u{1F600}\u2028"),
      String.raw`"\u{E9}\u{1F600}\u{2028}"`,
    );
  });

  await suite.test("emitted literals compile and round-trip through Swift", async () => {
    const tokenSource = String.raw`
export const tokens = {
  strings: {
    quote: "quote: \"",
    backslash: "\\",
    controls: "\b\f\t\n\r\u0000\u0001\u001F\u007F",
    unicode: "\u00E9\u2028\uD83D\uDE00",
  },
} as const;
export type Tokens = typeof tokens;
`;
    const values = ['quote: "', "\\", "\b\f\t\n\r\0\u0001\u001F\u007F", "\u00E9\u2028\u{1F600}"];
    const source = [
      "import Foundation",
      renderSwiftTokens(parseTokensSource(tokenSource)),
      "let values: [String] = [",
      "    Tokens.Strings.quote,",
      "    Tokens.Strings.backslash,",
      "    Tokens.Strings.controls,",
      "    Tokens.Strings.unicode,",
      "]",
      "for value in values {",
      "    print(Data(value.utf8).base64EncodedString())",
      "}",
      "",
    ].join("\n");
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "brownsync-swift-token-test-"));
    try {
      const sourcePath = path.join(temporaryDirectory, "main.swift");
      const executablePath = path.join(temporaryDirectory, "literal-test");
      await writeFile(sourcePath, source, "utf8");
      const compiled = spawnSync("xcrun", ["swiftc", sourcePath, "-o", executablePath], {
        encoding: "utf8",
      });
      assert.equal(compiled.status, 0, compiled.stderr);
      const executed = spawnSync(executablePath, [], { encoding: "utf8" });
      assert.equal(executed.status, 0, executed.stderr);
      assert.deepEqual(
        executed.stdout.trimEnd().split("\n"),
        values.map((value) => Buffer.from(value, "utf8").toString("base64")),
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  await suite.test("rejects a lone UTF-16 surrogate", () => {
    const invalidSource = String.raw`
export const tokens = { broken: "\uD800" } as const;
export type Tokens = typeof tokens;
`;
    assert.throws(
      () => renderSwiftTokens(parseTokensSource(invalidSource)),
      /lone surrogate code unit U\+D800/,
    );
  });
});
