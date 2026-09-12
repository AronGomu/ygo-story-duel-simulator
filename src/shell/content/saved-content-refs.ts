import type {
  ContentSetRef,
  ContentResult,
  SavedContentRefsPort,
} from "../../content/index.ts";
import {
  STORY_SAVES_DATABASE_NAME,
  STORY_SAVES_STORE_NAME,
} from "../screens/story-save-presence.ts";

/** No legacy migration. Unknown save schemas fail closed until T7 owns schema5. */
export const savedContentRefs: SavedContentRefsPort = {
  read(): Promise<ContentResult<readonly ContentSetRef[]>> {
    return new Promise((resolve) => {
      const unavailable = () =>
        resolve({
          kind: "failed",
          code: "CONTENT_STORAGE_UNAVAILABLE",
          packId: null,
          path: null,
        });
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(STORY_SAVES_DATABASE_NAME);
      } catch {
        unavailable();
        return;
      }
      let missing = false;
      request.onupgradeneeded = () => {
        missing = true;
        request.transaction?.abort();
      };
      request.onerror = () =>
        missing ? resolve({ kind: "ok", value: [] }) : unavailable();
      request.onblocked = unavailable;
      request.onsuccess = () => {
        const db = request.result;
        try {
          if (!db.objectStoreNames.contains(STORY_SAVES_STORE_NAME)) {
            db.close();
            unavailable();
            return;
          }
          const tx = db.transaction(STORY_SAVES_STORE_NAME, "readonly");
          const rows = tx.objectStore(STORY_SAVES_STORE_NAME).getAll();
          tx.oncomplete = () => {
            db.close();
            const legacyOnly = (rows.result as unknown[]).every(
              (row) =>
                row &&
                typeof row === "object" &&
                "schemaVersion" in row &&
                [1, 2, 3, 4].includes(row.schemaVersion as number),
            );
            resolve(
              legacyOnly
                ? { kind: "ok", value: [] }
                : {
                    kind: "failed",
                    code: "CONTENT_INCOMPATIBLE",
                    packId: null,
                    path: null,
                  },
            );
          };
          tx.onabort = () => {
            db.close();
            unavailable();
          };
          tx.onerror = () => {
            db.close();
            unavailable();
          };
        } catch {
          db.close();
          unavailable();
        }
      };
    });
  },
};
