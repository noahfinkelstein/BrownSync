import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const generatorPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(generatorPath), "..");
const sourcePath = path.join(repositoryRoot, "packages/contract/src/tokens.ts");
const outputPath = path.join(repositoryRoot, "apps/ios/Generated/Tokens.swift");

class Parser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parseModule() {
    this.expectIdentifier("export");
    this.expectIdentifier("const");
    this.expectIdentifier("tokens");
    this.expect("=");
    const value = this.parseValue("tokens");
    this.expectIdentifier("as");
    this.expectIdentifier("const");
    this.consume(";");
    this.expectIdentifier("export");
    this.expectIdentifier("type");
    this.expectIdentifier("Tokens");
    this.expect("=");
    this.expectIdentifier("typeof");
    this.expectIdentifier("tokens");
    this.consume(";");
    this.skipTrivia();
    if (this.index !== this.source.length) {
      this.fail("unexpected content after the Tokens type alias");
    }
    return value;
  }

  parseValue(valuePath) {
    const token = this.peek();
    if (token.kind === "string" || token.kind === "integer") {
      this.next();
      return token;
    }
    if (token.value === "{") {
      return this.parseObject(valuePath);
    }
    if (token.value === "[") {
      return this.parseArray(valuePath);
    }
    this.fail(
      `unsupported value at ${valuePath}; only objects, strings, integers, and homogeneous scalar arrays are allowed`,
      token.start,
    );
  }

  parseObject(valuePath) {
    this.expect("{");
    const entries = [];
    const seenKeys = new Set();
    while (!this.consume("}")) {
      const keyToken = this.next();
      if (!["identifier", "string", "integer"].includes(keyToken.kind)) {
        this.fail(`unsupported object key at ${valuePath}`, keyToken.start);
      }
      const key = String(keyToken.value);
      if (seenKeys.has(key)) {
        this.fail(`duplicate key ${JSON.stringify(key)} at ${valuePath}`, keyToken.start);
      }
      seenKeys.add(key);
      this.expect(":");
      entries.push({
        key,
        keyKind: keyToken.kind === "integer" ? "integer" : "name",
        value: this.parseValue(`${valuePath}.${key}`),
      });
      if (this.consume("}")) {
        break;
      }
      this.expect(",");
      if (this.consume("}")) {
        break;
      }
    }
    if (entries.length === 0) {
      this.fail(`empty objects are unsupported at ${valuePath}`);
    }
    const keyKinds = new Set(entries.map((entry) => entry.keyKind));
    if (keyKinds.size > 1) {
      this.fail(`mixed numeric and named object keys are unsupported at ${valuePath}`);
    }
    return { kind: "object", entries, keyKind: entries[0].keyKind };
  }

  parseArray(valuePath) {
    this.expect("[");
    const values = [];
    while (!this.consume("]")) {
      values.push(this.parseValue(`${valuePath}[${values.length}]`));
      if (this.consume("]")) {
        break;
      }
      this.expect(",");
      if (this.consume("]")) {
        break;
      }
    }
    if (values.length === 0) {
      this.fail(`empty arrays are unsupported at ${valuePath}`);
    }
    const kinds = new Set(values.map((value) => value.kind));
    if (kinds.size !== 1) {
      this.fail(`mixed-type arrays are unsupported at ${valuePath}`);
    }
    const [kind] = kinds;
    if (kind !== "string" && kind !== "integer") {
      this.fail(`arrays may contain only strings or integers at ${valuePath}`);
    }
    return { kind: "array", values, elementKind: kind };
  }

  peek() {
    const start = this.index;
    const token = this.next();
    this.index = start;
    return token;
  }

  next() {
    this.skipTrivia();
    const start = this.index;
    const character = this.source[this.index];
    if (character === undefined) {
      return { kind: "eof", value: "", start };
    }
    if ("{}[]:,=;".includes(character)) {
      this.index += 1;
      return { kind: "punctuation", value: character, start };
    }
    if (character === '"' || character === "'") {
      return this.readString(character, start);
    }
    const integer = this.source.slice(this.index).match(/^-?(?:0|[1-9]\d*)/);
    if (integer) {
      this.index += integer[0].length;
      const value = Number(integer[0]);
      if (!Number.isSafeInteger(value)) {
        this.fail(`integer ${integer[0]} is outside JavaScript's safe range`, start);
      }
      return { kind: "integer", value, start };
    }
    const identifier = this.source.slice(this.index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (identifier) {
      this.index += identifier[0].length;
      return { kind: "identifier", value: identifier[0], start };
    }
    this.fail(`unexpected character ${JSON.stringify(character)}`, start);
  }

  readString(quote, start) {
    this.index += 1;
    let value = "";
    while (this.index < this.source.length) {
      const character = this.source[this.index++];
      if (character === quote) {
        return { kind: "string", value, start };
      }
      if (character !== "\\") {
        value += character;
        continue;
      }
      const escaped = this.source[this.index++];
      const simpleEscapes = {
        '"': '"',
        "'": "'",
        "\\": "\\",
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
      };
      if (escaped in simpleEscapes) {
        value += simpleEscapes[escaped];
        continue;
      }
      if (escaped === "u") {
        const codePoint = this.source.slice(this.index, this.index + 4);
        if (!/^[0-9A-Fa-f]{4}$/.test(codePoint)) {
          this.fail("invalid Unicode escape", this.index - 2);
        }
        value += String.fromCharCode(Number.parseInt(codePoint, 16));
        this.index += 4;
        continue;
      }
      this.fail(`unsupported string escape \\${escaped}`, this.index - 2);
    }
    this.fail("unterminated string literal", start);
  }

  skipTrivia() {
    while (this.index < this.source.length) {
      const rest = this.source.slice(this.index);
      const whitespace = rest.match(/^\s+/);
      if (whitespace) {
        this.index += whitespace[0].length;
        continue;
      }
      if (rest.startsWith("//")) {
        const newline = rest.indexOf("\n");
        this.index += newline === -1 ? rest.length : newline + 1;
        continue;
      }
      if (rest.startsWith("/*")) {
        const end = rest.indexOf("*/", 2);
        if (end === -1) {
          this.fail("unterminated block comment");
        }
        this.index += end + 2;
        continue;
      }
      break;
    }
  }

  expect(value) {
    const token = this.next();
    if (token.value !== value) {
      this.fail(
        `expected ${JSON.stringify(value)}, found ${JSON.stringify(token.value)}`,
        token.start,
      );
    }
  }

  expectIdentifier(value) {
    const token = this.next();
    if (token.kind !== "identifier" || token.value !== value) {
      this.fail(`expected ${value}, found ${JSON.stringify(token.value)}`, token.start);
    }
  }

  consume(value) {
    const start = this.index;
    const token = this.next();
    if (token.value === value) {
      return true;
    }
    this.index = start;
    return false;
  }

  fail(message, index = this.index) {
    const line = this.source.slice(0, index).split("\n").length;
    throw new Error(`${message} (line ${line})`);
  }
}

const swiftKeywords = new Set([
  "Any",
  "Protocol",
  "Self",
  "Type",
  "as",
  "associatedtype",
  "break",
  "case",
  "catch",
  "class",
  "continue",
  "default",
  "defer",
  "deinit",
  "do",
  "else",
  "enum",
  "extension",
  "fallthrough",
  "false",
  "fileprivate",
  "for",
  "func",
  "guard",
  "if",
  "import",
  "in",
  "init",
  "inout",
  "internal",
  "is",
  "let",
  "nil",
  "open",
  "operator",
  "private",
  "protocol",
  "public",
  "repeat",
  "rethrows",
  "return",
  "some",
  "static",
  "struct",
  "subscript",
  "super",
  "switch",
  "throw",
  "throws",
  "true",
  "try",
  "typealias",
  "var",
  "where",
  "while",
]);

function swiftMemberName(name, valuePath) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`unsupported Swift member name ${JSON.stringify(name)} at ${valuePath}`);
  }
  return swiftKeywords.has(name) ? `\`${name}\`` : name;
}

function swiftTypeName(name, valuePath) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`unsupported Swift namespace name ${JSON.stringify(name)} at ${valuePath}`);
  }
  const candidate = `${name[0].toUpperCase()}${name.slice(1)}`;
  return swiftKeywords.has(candidate) ? `${candidate}Tokens` : candidate;
}

function scalarType(kind, valuePath) {
  if (kind === "string") return "String";
  if (kind === "integer") return "Int";
  throw new Error(`unsupported scalar kind ${kind} at ${valuePath}`);
}

export function swiftStringLiteral(value, valuePath = "string") {
  if (typeof value !== "string") {
    throw new Error(`expected a string at ${valuePath}`);
  }
  let literal = '"';
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0);
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      const formatted = codePoint.toString(16).toUpperCase().padStart(4, "0");
      throw new Error(`lone surrogate code unit U+${formatted} at ${valuePath}`);
    }
    switch (codePoint) {
      case 0x00:
        literal += "\\0";
        break;
      case 0x08:
        literal += "\\u{8}";
        break;
      case 0x09:
        literal += "\\t";
        break;
      case 0x0a:
        literal += "\\n";
        break;
      case 0x0c:
        literal += "\\u{C}";
        break;
      case 0x0d:
        literal += "\\r";
        break;
      case 0x22:
        literal += '\\"';
        break;
      case 0x5c:
        literal += "\\\\";
        break;
      default:
        if (codePoint >= 0x20 && codePoint <= 0x7e) {
          literal += scalar;
        } else {
          literal += `\\u{${codePoint.toString(16).toUpperCase()}}`;
        }
    }
  }
  return `${literal}"`;
}

function scalarLiteral(value, valuePath) {
  if (value.kind === "string") return swiftStringLiteral(value.value, valuePath);
  if (value.kind === "integer") return String(value.value);
  throw new Error(`unsupported scalar value at ${valuePath}`);
}

function renderValue(value, valuePath, indent) {
  if (value.kind === "string" || value.kind === "integer") {
    return { type: scalarType(value.kind, valuePath), lines: [scalarLiteral(value, valuePath)] };
  }
  if (value.kind === "array") {
    const type = `[${scalarType(value.elementKind, valuePath)}]`;
    const literal = value.values.map((item) => scalarLiteral(item, valuePath)).join(", ");
    return { type, lines: [`[${literal}]`] };
  }
  if (value.kind === "object" && value.keyKind === "integer") {
    const valueKinds = new Set(value.entries.map((entry) => entry.value.kind));
    if (valueKinds.size !== 1) {
      throw new Error(`mixed-value numeric dictionary is unsupported at ${valuePath}`);
    }
    const [valueKind] = valueKinds;
    const valueType = scalarType(valueKind, valuePath);
    const lines = ["["];
    for (const entry of value.entries) {
      lines.push(
        `${indent}    ${entry.key}: ${scalarLiteral(entry.value, `${valuePath}.${entry.key}`)},`,
      );
    }
    lines.push(`${indent}]`);
    return { type: `[Int: ${valueType}]`, lines };
  }
  throw new Error(`nested named object must render as a namespace at ${valuePath}`);
}

function renderNamespace(name, object, valuePath, depth) {
  if (object.kind !== "object" || object.keyKind !== "name") {
    throw new Error(`expected a named object at ${valuePath}`);
  }
  const indent = "    ".repeat(depth);
  const lines = [`${indent}enum ${name} {`];
  for (const entry of object.entries) {
    const entryPath = `${valuePath}.${entry.key}`;
    if (entry.value.kind === "object" && entry.value.keyKind === "name") {
      lines.push(
        ...renderNamespace(swiftTypeName(entry.key, entryPath), entry.value, entryPath, depth + 1),
      );
      continue;
    }
    const memberName = swiftMemberName(entry.key, entryPath);
    const rendered = renderValue(entry.value, entryPath, `${indent}    `);
    if (rendered.lines.length === 1) {
      lines.push(`${indent}    static let ${memberName}: ${rendered.type} = ${rendered.lines[0]}`);
    } else {
      lines.push(`${indent}    static let ${memberName}: ${rendered.type} = ${rendered.lines[0]}`);
      lines.push(...rendered.lines.slice(1));
    }
  }
  lines.push(`${indent}}`);
  return lines;
}

export function parseTokensSource(source) {
  return new Parser(source).parseModule();
}

export function renderSwiftTokens(tokens) {
  return [
    "// Generated by scripts/gen-swift-tokens.mjs from packages/contract/src/tokens.ts.",
    "// Do not edit this file directly.",
    "",
    ...renderNamespace("Tokens", tokens, "tokens", 0),
    "",
  ].join("\n");
}

export async function generateSwiftTokens() {
  const source = await readFile(sourcePath, "utf8");
  const generated = renderSwiftTokens(parseTokensSource(source));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated, "utf8");
  return generated;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(generatorPath)) {
  await generateSwiftTokens();
}
