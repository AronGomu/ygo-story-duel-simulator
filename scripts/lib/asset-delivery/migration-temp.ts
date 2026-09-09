import path from "node:path";
import { assertSourcePath } from "./path-guards.ts";
import { fail } from "./failure.ts";

const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
export const MIGRATION_TEMP_NAME = new RegExp(`^\\.m-${UUID}$`);
const LEGACY_TEMP_NAME = new RegExp(`\\.${UUID}\\.migration-tmp$`);

/** Unknown operational-shaped entries fail closed; never omit or delete by name. */
export function assertNotMigrationTemp(relative: string): void {
  if (
    relative
      .split("/")
      .some(
        (part) => MIGRATION_TEMP_NAME.test(part) || LEGACY_TEMP_NAME.test(part),
      )
  )
    fail("ASSET_RECOVERY_REQUIRED", relative);
}

export function migrationTempPath(
  destination: string,
  id = "00000000-0000-0000-0000-000000000000",
): string {
  const temporary = `${path.posix.dirname(destination)}/.m-${id}`;
  for (const relative of [destination, temporary]) {
    assertSourcePath(relative);
    if (
      relative.split("/").some((part) => Buffer.byteLength(part, "utf8") > 255)
    )
      fail("ASSET_PATH_UNSAFE");
  }
  return temporary;
}
