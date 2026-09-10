import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import ts from "typescript";

/** Transport fixture only: no installer, hosted CORS claim or outbound request. */
test("content URL resolver retains exact cross-origin bytes under Chromium", async ({
  page,
}) => {
  const bytes = Buffer.from('{"fixture":"immutable-content"}\n');
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const base = "https://content-fixture.example/ascencio-assets/v1/";
  const requests: string[] = [];
  await page.route(`${base}**`, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": new URL(page.url()).origin,
        "Cache-Control": "public,max-age=31536000,immutable",
      },
      body: bytes,
    });
  });
  await page.goto("./");
  const source = await readFile("src/content/content-object-url.ts", "utf8");
  const javascript = ts.transpileModule(
    source.replace(/^export /gm, "") +
      "\nglobalThis.__contentUrlFixture = contentObjectUrl;",
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText;
  await page.addScriptTag({ type: "module", content: javascript });
  const result = await page.evaluate(
    async ({ base, sha256 }) => {
      const resolve = (
        globalThis as typeof globalThis & {
          __contentUrlFixture: (
            base: string,
            kind: "indexes",
            sha: string,
          ) => string;
        }
      ).__contentUrlFixture;
      const url = resolve(base, "indexes", sha256);
      const response = await fetch(url, {
        credentials: "omit",
        redirect: "error",
      });
      const body = await response.arrayBuffer();
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
        (value) => value.toString(16).padStart(2, "0"),
      ).join("");
      return {
        url,
        status: response.status,
        bytes: body.byteLength,
        digest,
        origin: new URL(url).origin,
      };
    },
    { base, sha256 },
  );
  expect(result).toEqual({
    url: `${base}content/indexes/${sha256}.json`,
    status: 200,
    bytes: bytes.length,
    digest: sha256,
    origin: "https://content-fixture.example",
  });
  expect(requests).toEqual([result.url]);
});
