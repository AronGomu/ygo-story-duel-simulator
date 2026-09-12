import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseChapterSelections,
  verifyContentSetup,
} from "../../scripts/lib/content-setup.ts";

import {
  contentDigest as digest,
  chapterIds as ids,
  contentSetupFixture as fixture,
  bindContentSource,
} from "../fixtures/content-setup.ts";

const codes = (input: ReturnType<typeof fixture>) =>
  verifyContentSetup(input).blockers.map((item) => item.code);

describe("content setup", () => {
  it("public URL is not approval", () => {
    const input = fixture();
    Object.assign(input.distribution, {
      engineSource: "https://example.invalid/engine",
      scriptSource: "https://example.invalid/scripts",
      databaseTerms: "https://example.invalid/db",
      artPermission: "https://example.invalid/art",
      storyMediaPermission: "https://example.invalid/story",
    });
    const report = verifyContentSetup(input);
    expect(report.publishReady).toBe(false);
    expect(report.blockers).toContainEqual(
      expect.objectContaining({ code: "LICENSE_EVIDENCE_REQUIRED" }),
    );
  });
  it("mapping is owner input", () => {
    const input = fixture();
    expect(verifyContentSetup({ ...input, selections: null }).codeReady).toBe(
      false,
    );
    expect(
      verifyContentSetup({ ...input, selections: null }).blockers,
    ).toContainEqual(
      expect.objectContaining({ code: "OWNER_MAPPING_REQUIRED" }),
    );
  });
  it("readiness resolves approved alias but still blocks an unrelated included card", () => {
    const input = fixture();
    const source = JSON.parse(input.source.toString("utf8"));
    source.sets[0].cards[0] = {
      id: 81480461,
      name: "Barrel Dragon",
      printings: [{ code: "ONE-001", rarity: "Rare", rarityCode: "(R)" }],
    };
    bindContentSource(input, Buffer.from(JSON.stringify(source)));
    input.availability.runtimeCardCodes = new Set([81480460]);
    input.availability.fullCardCodes = new Set([81480460]);
    input.availability.croppedCardCodes = new Set([81480460]);
    expect(verifyContentSetup(input).codeReady).toBe(true);

    source.sets[0].cards.push({
      id: 999,
      name: "Unrelated included card",
      printings: [{ code: "ONE-002", rarity: "Common", rarityCode: "(C)" }],
    });
    bindContentSource(input, Buffer.from(JSON.stringify(source)));
    expect(verifyContentSetup(input).codeReady).toBe(false);
    expect(codes(input)).toContain("SOURCE_COVERAGE_REQUIRED");
  });
  it.each([
    "unknown set",
    "unsupported code",
    "missing full",
    "missing cropped",
    "missing set image",
    "missing prototype",
    "missing runtime",
    "incompatible prototype decks",
  ])("set coverage is exact: %s", (fault) => {
    const input = fixture();
    if (fault === "unknown set")
      input.selections.chapters[0]!.setNames.push("unknown");
    if (fault === "unsupported code")
      input.availability.runtimeCardCodes.delete(1);
    if (fault === "missing full") input.availability.fullCardCodes.delete(1);
    if (fault === "missing cropped")
      input.availability.croppedCardCodes.delete(1);
    if (fault === "missing set image")
      input.availability.setNames.delete(ids[0]!);
    if (fault === "missing prototype")
      input.availability.prototypeMedia = false;
    if (fault === "missing runtime") input.availability.runtimeVerified = false;
    if (fault === "incompatible prototype decks")
      input.availability.prototypeDecksCompatible = false;
    expect(codes(input)).toContain("SOURCE_COVERAGE_REQUIRED");
    expect(verifyContentSetup(input).codeReady).toBe(false);
  });
  it("parser accepts exactly one chapter-01", () => {
    const input = fixture();
    expect(parseChapterSelections(input.selections)).toEqual(input.selections);
  });
  it.each([
    "chapter-02",
    "chapter-03",
    "chapter-04",
    "chapter-05",
    "chapter-06",
    "chapter-07",
  ])("parser rejects later chapter ID or appended row: %s", (id) => {
    const input = fixture();
    const later = { ...input.selections.chapters[0]!, id };
    for (const chapters of [[later], [...input.selections.chapters, later]]) {
      expect(
        parseChapterSelections({ ...input.selections, chapters }),
      ).toBeNull();
    }
  });
  it.each([
    "at exclusive end",
    "after exclusive end",
    "before start",
    "undated",
  ])("selected set outside Chapter 1 rejects: %s", (fault) => {
    const input = fixture();
    const source = JSON.parse(input.source.toString("utf8"));
    source.sets[0].tcgReleaseDate = {
      "at exclusive end": "2002-03-08",
      "after exclusive end": "2002-03-09",
      "before start": "2000-03-08",
      undated: null,
    }[fault];
    bindContentSource(input, Buffer.from(JSON.stringify(source)));
    expect(verifyContentSetup(input)).toMatchObject({
      codeReady: false,
      publishReady: false,
    });
    expect(codes(input)).toContain("SOURCE_COVERAGE_REQUIRED");
  });
  it.each([
    "missing",
    "pending",
    "pending status",
    "missing boundary",
    "missing evidence",
    "missing convention",
    "wrong source",
    "wrong cutoff",
    "missing end",
    "missing end evidence",
    "reversed interval",
    "empty interval",
    "end after cutoff",
    "later policy row",
    "later policy ID",
  ])("unresolved date policy rejects %s", (fault) => {
    const input = fixture();
    const chapterPolicy = structuredClone(input.chapterPolicy);
    if (fault === "pending")
      chapterPolicy.boundaryEvidenceStatus = "unresolved";
    if (fault === "pending status")
      chapterPolicy.status = "approved-policy-incomplete-date-evidence";
    if (fault === "missing boundary")
      Object.assign(chapterPolicy.chapters[0]!, { startsOn: null });
    if (fault === "missing evidence")
      chapterPolicy.chapters[0]!.boundaryEvidence = "";
    if (fault === "missing convention") chapterPolicy.dateConvention = "";
    if (fault === "wrong source") chapterPolicy.sourceSha256 = "0".repeat(64);
    if (fault === "wrong cutoff") chapterPolicy.snapshotCutoff = "2026-09-08";
    if (fault === "missing end")
      Object.assign(chapterPolicy.chapters[0]!, { endsBefore: null });
    if (fault === "missing end evidence")
      chapterPolicy.chapters[0]!.endBoundaryEvidence = "";
    if (fault === "reversed interval")
      chapterPolicy.chapters[0]!.endsBefore = "2000-01-01";
    if (fault === "empty interval")
      chapterPolicy.chapters[0]!.endsBefore =
        chapterPolicy.chapters[0]!.startsOn;
    if (fault === "end after cutoff")
      chapterPolicy.chapters[0]!.endsBefore = "2027-01-01";
    if (fault === "later policy row")
      chapterPolicy.chapters.push({
        ...chapterPolicy.chapters[0]!,
        id: "chapter-02",
      });
    if (fault === "later policy ID")
      chapterPolicy.chapters[0]!.id = "chapter-02";
    const report = verifyContentSetup({
      ...input,
      chapterPolicy: fault === "missing" ? null : chapterPolicy,
    });
    expect(report).toMatchObject({ codeReady: false, publishReady: false });
    expect(report.blockers).toContainEqual(
      expect.objectContaining({ code: "SOURCE_COVERAGE_REQUIRED" }),
    );
  });
  it("approved interval starts inclusive, explicit end exclusive", () => {
    const input = fixture();
    const source = JSON.parse(input.source.toString("utf8"));
    source.sets.push({
      name: "last day of first era",
      code: "LAST",
      tcgReleaseDate: "2002-03-07",
      cards: [
        {
          id: 1,
          name: "Synthetic card 1",
          printings: [
            { code: "LAST-001", rarity: "Common", rarityCode: "(C)" },
          ],
        },
      ],
    });
    input.selections.chapters[0]!.setNames.push("last day of first era");
    input.availability.setNames.add("last day of first era");
    bindContentSource(input, Buffer.from(JSON.stringify(source)));
    expect(verifyContentSetup(input).codeReady).toBe(true);
    source.sets[3].tcgReleaseDate = "2002-03-08";
    bindContentSource(input, Buffer.from(JSON.stringify(source)));
    expect(verifyContentSetup(input).codeReady).toBe(false);
  });
  it.each(["raw digest", "decoded digest"])(
    "malformed UTF-8 rejects %s",
    (hashMode) => {
      const input = fixture();
      const malformed = Buffer.concat([
        Buffer.from('{"purpose":"'),
        Buffer.from([0xff]),
        Buffer.from('",'),
        input.source.subarray(1),
      ]);
      bindContentSource(input, malformed);
      if (hashMode === "decoded digest") {
        input.selections.sourceSha256 = digest(malformed.toString("utf8"));
        input.chapterPolicy.sourceSha256 = input.selections.sourceSha256;
      }
      expect(verifyContentSetup(input).codeReady).toBe(false);
    },
  );
  it("valid UTF-8 requires the digest of exact raw bytes", () => {
    const input = fixture();
    const source = JSON.parse(input.source.toString("utf8"));
    source.purpose = "lawful synthetic café fixture";
    bindContentSource(
      input,
      Buffer.from(JSON.stringify(source, null, 2) + "\n"),
    );
    expect(verifyContentSetup(input).codeReady).toBe(true);
    input.selections.sourceSha256 = digest(JSON.stringify(source));
    expect(verifyContentSetup(input).codeReady).toBe(false);
  });
  it("readiness separated", () => {
    expect(verifyContentSetup(fixture())).toMatchObject({
      codeReady: true,
      publishReady: false,
    });
  });
  it("public prerequisites require explicit complete attestations and secret presence", () => {
    const input = fixture();
    Object.assign(input.distribution, {
      status: "approved",
      engineSource: "review:engine",
      scriptSource: "review:scripts",
      databaseTerms: "review:db",
      artPermission: "review:art",
      storyMediaPermission: "review:story",
    });
    input.setup = {
      schemaVersion: 1,
      cloudflare: {
        plan: "free",
        project: "fixture-project",
        staticOnly: true,
      },
      github: {
        environment: "production",
        protectionEvidence: "review:protected",
      },
      devices: {
        android: "tester:android",
        iphone: "tester:iphone",
        ipad: "tester:ipad",
      },
    };
    input.environment = {
      CLOUDFLARE_API_TOKEN: "fake-token-sentinel",
      CLOUDFLARE_ACCOUNT_ID: "fake-account-sentinel",
      CLOUDFLARE_PAGES_PROJECT: "fixture-project",
    };
    expect(verifyContentSetup(input)).toMatchObject({
      codeReady: true,
      publishReady: true,
      blockers: [],
    });
    for (const name of Object.keys(input.environment)) {
      const environment = { ...input.environment, [name]: " " };
      expect(verifyContentSetup({ ...input, environment }).publishReady).toBe(
        false,
      );
    }
    for (const key of [
      "engineSource",
      "scriptSource",
      "databaseTerms",
      "artPermission",
      "storyMediaPermission",
    ]) {
      expect(
        verifyContentSetup({
          ...input,
          distribution: { ...input.distribution, [key]: null },
        }),
      ).toMatchObject({ codeReady: true, publishReady: false });
    }
    for (const setup of [
      null,
      {},
      { schemaVersion: 1 },
      {
        ...(input.setup as object),
        devices: {
          android: "review:device",
          iphone: null,
          ipad: "review:device",
        },
      },
    ]) {
      expect(verifyContentSetup({ ...input, setup })).toMatchObject({
        codeReady: true,
        publishReady: false,
      });
    }
    expect(JSON.stringify(verifyContentSetup(input))).not.toContain(
      "fake-token-sentinel",
    );
    expect(JSON.stringify(verifyContentSetup(input))).not.toContain(
      "fake-account-sentinel",
    );
    input.distribution.sourceRevision = "wrong-revision";
    expect(verifyContentSetup(input).publishReady).toBe(false);
  });
  it.each([
    "undated",
    "empty",
    "future",
    "unassigned",
    "duplicate",
    "extra code",
    "wrong hash",
    "later chapter",
    "prototype unpublished",
  ])("fails closed: %s", (fault) => {
    const input = fixture();
    const source = JSON.parse(input.source.toString("utf8"));
    if (fault === "undated") source.sets[0].tcgReleaseDate = null;
    if (fault === "empty") source.sets[0].cards = [];
    if (fault === "future") source.sets[0].tcgReleaseDate = "2027-01-01";
    if (fault === "unassigned") input.selections.chapters[0]!.setNames = [];
    if (fault === "duplicate")
      input.selections.chapters[0]!.setNames.push(ids[0]!);
    if (fault === "extra code")
      Object.assign(input.selections.chapters[0]!, {
        additionalCardCodes: [999],
      });
    if (fault === "later chapter")
      input.selections.chapters.push({
        ...input.selections.chapters[0]!,
        id: "chapter-02",
      });
    if (fault === "prototype unpublished")
      input.selections.chapters[0]!.published = false;
    bindContentSource(input, Buffer.from(JSON.stringify(source)));
    input.selections.sourceSha256 =
      fault === "wrong hash" ? "A".repeat(64) : digest(input.source);
    expect(verifyContentSetup(input).codeReady).toBe(false);
    expect(verifyContentSetup(input).publishReady).toBe(false);
  });
  it("post-cutoff sets are out of scope, not missing assignments", () => {
    const input = fixture();
    const source = JSON.parse(input.source.toString("utf8"));
    source.sets.push({
      name: "future release",
      tcgReleaseDate: "2026-10-08",
      cards: [],
    });
    bindContentSource(input, Buffer.from(JSON.stringify(source)));
    input.selections.sourceSha256 = digest(input.source);
    expect(verifyContentSetup(input).codeReady).toBe(true);
    input.selections.chapters[0]!.setNames.push("future release");
    expect(verifyContentSetup(input).codeReady).toBe(false);
  });
  it("identical card sets retain both identities and require each set's assets and selection", () => {
    const input = fixture();
    const source = JSON.parse(input.source.toString("utf8"));
    source.sets[1].tcgReleaseDate = source.sets[0].tcgReleaseDate;
    source.sets[1].cards = structuredClone(source.sets[0].cards);
    bindContentSource(input, Buffer.from(JSON.stringify(source)));
    input.selections.chapters[0]!.setNames.push("chapter-02");
    input.availability.setNames.add("chapter-02");
    expect(
      parseChapterSelections(input.selections)?.chapters[0]!.setNames,
    ).toEqual(["chapter-01", "chapter-02"]);
    expect(verifyContentSetup(input).codeReady).toBe(true);
    input.availability.setNames.delete("chapter-02");
    expect(verifyContentSetup(input).codeReady).toBe(false);
    input.availability.setNames.add("chapter-02");
    input.selections.chapters[0]!.setNames.pop();
    expect(
      verifyContentSetup(input).blockers.some(({ detail }) =>
        detail.includes("1 unassigned in-scope"),
      ),
    ).toBe(true);
  });
  it("same card earlier and later remains included through earlier set only", () => {
    const input = fixture();
    const source = JSON.parse(input.source.toString("utf8"));
    source.sets[1].cards.push({ id: 1 });
    input.availability.fullCardCodes = new Set([1]);
    input.availability.croppedCardCodes = new Set([1]);
    input.availability.runtimeCardCodes = new Set([1]);
    bindContentSource(input, Buffer.from(JSON.stringify(source)));
    input.selections.sourceSha256 = digest(input.source);
    expect(verifyContentSetup(input).codeReady).toBe(true);
  });
  it("later-only missing sets/cards/assets and unknown unselected provenance do not block scoped readiness", () => {
    const input = fixture();
    const source = JSON.parse(input.source.toString("utf8"));
    source.sets[1].cards = [];
    source.sets.push({
      name: "unknown date",
      tcgReleaseDate: null,
      cards: [{ id: 998 }],
    });
    source.cardsWithoutSetMembership = [{ id: 999 }];
    bindContentSource(input, Buffer.from(JSON.stringify(source)));
    input.availability.runtimeCardCodes = new Set([1]);
    input.availability.fullCardCodes = new Set([1]);
    input.availability.croppedCardCodes = new Set([1]);
    const report = verifyContentSetup(input);
    expect(report).toMatchObject({ codeReady: true, publishReady: false });
    expect(codes(input)).not.toContain("SOURCE_COVERAGE_REQUIRED");
  });
  it("missing selection of another in-interval set blocks completeness", () => {
    const input = fixture();
    const source = JSON.parse(input.source.toString("utf8"));
    source.sets[1].tcgReleaseDate = source.sets[0].tcgReleaseDate;
    bindContentSource(input, Buffer.from(JSON.stringify(source)));
    expect(verifyContentSetup(input).codeReady).toBe(false);
    expect(
      verifyContentSetup(input).blockers.some(({ detail }) =>
        detail.includes("1 unassigned in-scope"),
      ),
    ).toBe(true);
  });
  it("later-only set or additional card cannot enter selected content", () => {
    const input = fixture();
    input.selections.chapters[0]!.setNames.push("chapter-02");
    expect(verifyContentSetup(input).codeReady).toBe(false);
    input.selections.chapters[0]!.setNames.pop();
    Object.assign(input.selections.chapters[0]!, { additionalCardCodes: [2] });
    expect(parseChapterSelections(input.selections)).toBeNull();
  });
  it("malformed and oversized input is a prerequisite failure", () => {
    const input = fixture();
    for (const source of ["{", "null", " ".repeat(16 * 1024 * 1024 + 1)]) {
      expect(
        verifyContentSetup({ ...input, source: Buffer.from(source) }).codeReady,
      ).toBe(false);
    }
  });
  it("source copy and approved policy remain explicit incomplete inputs", async () => {
    const bytes = await readFile(
      "content/authoring/card-set-source.json",
      "utf8",
    );
    expect(digest(bytes)).toBe(
      "b3ac778e5f1b9927554ef8e66185a596c0c35d71ab642b448c952c6c9050496d",
    );
    const source = JSON.parse(bytes);
    expect(source.sets).toHaveLength(1036);
    expect(source.cardsWithoutSetMembership).toHaveLength(509);
    const policy = JSON.parse(
      await readFile("content/authoring/chapter-policy.json", "utf8"),
    );
    expect(
      policy.chapters.map((chapter: { id: string }) => chapter.id),
    ).toEqual(ids);
    expect(policy.membershipBasis).toBe("original-tcg-set-release-date");
    expect(policy.reprints).toBe(
      "include-every-printing-in-its-set-release-era",
    );
  });
  it("usage failure never echoes supplied arguments", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/verify-content-setup.ts", "fake-argument-sentinel"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(
      "fake-argument-sentinel",
    );
    expect(result.stderr).toContain(
      "Usage: npm run content:setup:verify [-- --public]",
    );
  });
  it("secrets never printed", async () => {
    const sentinel = "fake-secret-redaction-sentinel";
    const result = spawnSync(
      process.execPath,
      ["scripts/verify-content-setup.ts", "--public"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: sentinel,
          CLOUDFLARE_ACCOUNT_ID: sentinel,
          CLOUDFLARE_PAGES_PROJECT: sentinel,
        },
      },
    );
    expect(result.status).toBe(2);
    const report = await readFile(
      "generated/content/setup-report.json",
      "utf8",
    );
    expect(result.stdout + result.stderr + report).not.toContain(sentinel);
    expect(JSON.parse(report)).toMatchObject({
      codeReady: false,
      publishReady: false,
    });
  });
});
