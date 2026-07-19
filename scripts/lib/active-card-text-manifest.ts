import { readFileSync } from "node:fs";
import path from "node:path";

export interface ActiveCardTextManifestRecord {
  readonly code: number;
  readonly name: string;
  readonly description: string;
}

export function buildActiveCardTextManifest(
  projectRoot: string,
  codes: ReadonlySet<number>,
): readonly ActiveCardTextManifestRecord[] {
  const records: ActiveCardTextManifestRecord[] = [];
  const shards = new Map<number, readonly ActiveCardTextManifestRecord[]>();
  for (const code of [...codes].sort((left, right) => left - right)) {
    const shard = code % 64;
    let values = shards.get(shard);
    if (values === undefined) {
      const name = shard.toString(16).padStart(2, "0");
      values = JSON.parse(
        readFileSync(
          path.join(
            projectRoot,
            "generated/assets/current/catalog/texts/en",
            `${name}.json`,
          ),
          "utf8",
        ),
      ) as readonly ActiveCardTextManifestRecord[];
      shards.set(shard, values);
    }
    const record = values.find((candidate) => candidate.code === code);
    if (record === undefined)
      throw new Error(`Missing active card text for browser build: ${code}`);
    records.push(
      Object.freeze({
        code: record.code,
        name: record.name,
        description: record.description,
      }),
    );
  }
  return Object.freeze(records);
}
