import type { SystemStrings } from "./model.ts";

const supportedSections = new Set<keyof SystemStrings>([
  "system",
  "victory",
  "counter",
  "setname",
]);

export function parseStringsConf(content: string): SystemStrings {
  const result: SystemStrings = {
    system: {},
    victory: {},
    counter: {},
    setname: {},
  };

  for (const rawLine of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("!") || line.startsWith("#!")) {
      continue;
    }

    const match = /^!(\w+)\s+(\S+)\s*(.*)$/.exec(line);
    if (!match?.[1] || !match[2]) {
      continue;
    }

    const section = match[1].toLowerCase() as keyof SystemStrings;
    if (!supportedSections.has(section)) {
      continue;
    }

    result[section][match[2]] = match[3] ?? "";
  }

  return result;
}
