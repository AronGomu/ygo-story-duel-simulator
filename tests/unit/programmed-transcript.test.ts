import { describe, expect, it } from "vitest";
import {
  cardCode,
  cardInstanceId,
  choiceId,
  promptId,
} from "../../src/duel/contracts/ids.ts";
import type { PlayerPrompt } from "../../src/duel/contracts/player-prompt.ts";
import {
  expandProgrammedResponses,
  loadBasicDuelTranscript,
  loadProgrammedTranscript,
  parseProgrammedTranscript,
  resolveProgrammedResponse,
} from "../fixtures/programmed-transcript.ts";

describe("programmed response transcripts", () => {
  it("loads and expands the persisted basic duel transcript", async () => {
    const transcript = await loadBasicDuelTranscript();
    const responses = expandProgrammedResponses(transcript);

    expect(transcript.scenarioId).toBe("battle-and-chain");
    expect(transcript.runs).toHaveLength(52);
    expect(responses).toHaveLength(182);
    expect(responses[0]).toMatchObject({
      prompt: "idleCommand",
      selections: [{ action: "summon", card: { code: 97590747 } }],
    });

    const tribute = await loadProgrammedTranscript("tribute-special-v1");
    expect(tribute.scenarioId).toBe("tribute-special-and-target");
    expect(expandProgrammedResponses(tribute)).toHaveLength(110);
    expect(tribute.expectedTraceSha256).toMatch(/^[a-f0-9]{64}$/);

    const effects = await loadProgrammedTranscript("effects-recovery-v1");
    expect(effects.scenarioId).toBe("effects-recovery-and-position");
    expect(expandProgrammedResponses(effects)).toHaveLength(141);

    const promptMatrix = await loadProgrammedTranscript("prompt-matrix-v1");
    expect(promptMatrix.scenarioId).toBe("real-wasm-prompt-matrix");
    expect(expandProgrammedResponses(promptMatrix)).toHaveLength(16);

    const sortChain = await loadProgrammedTranscript("sort-chain-v1");
    expect(sortChain.scenarioId).toBe("shuffle-and-sort-chain");
    expect(expandProgrammedResponses(sortChain)).toHaveLength(5);

    const surrender = await loadProgrammedTranscript("surrender-v1");
    expect(surrender.scenarioId).toBe("surrender-at-opening");
    expect(expandProgrammedResponses(surrender)).toEqual([]);
  });

  it("resolves one exact stable domain fingerprint without raw indexes", () => {
    const prompt = cardSelectionPrompt();

    expect(
      resolveProgrammedResponse(
        prompt,
        {
          prompt: "selectCard",
          selections: [
            {
              action: "select",
              card: {
                code: 97590747,
                controller: 0,
                location: "hand",
                sequence: 1,
              },
            },
          ],
        },
        0,
      ),
    ).toEqual([choiceId("second-copy")]);
  });

  it("rejects prompt drift, ambiguous selections, and invalid counts", () => {
    const prompt = cardSelectionPrompt();
    expect(() =>
      resolveProgrammedResponse(
        prompt,
        { prompt: "chain", selections: [{ action: "pass" }] },
        2,
      ),
    ).toThrow("response 3 expected chain, received selectCard");
    expect(() =>
      resolveProgrammedResponse(
        prompt,
        { prompt: "selectCard", selections: [{ action: "select" }] },
        0,
      ),
    ).toThrow("ambiguous across 2 choices");
    expect(() =>
      parseProgrammedTranscript({
        schemaVersion: 1,
        scenarioId: "invalid",
        responseCount: 2,
        runCount: 1,
        runs: [
          {
            prompt: "chain",
            selections: [{ action: "pass" }],
          },
        ],
      }),
    ).toThrow("declares 2 responses but expands to 1");
    expect(() =>
      parseProgrammedTranscript({
        schemaVersion: 1,
        scenarioId: "oversized",
        responseCount: 10_001,
        runCount: 0,
        runs: [],
      }),
    ).toThrow("exceeds 10000 responses");
  });
});

function cardSelectionPrompt(): PlayerPrompt {
  return {
    id: promptId("select-card"),
    kind: "selectCard",
    player: 0,
    title: "Select a card",
    choices: [0, 1].map((sequence) => ({
      id: choiceId(sequence === 0 ? "first-copy" : "second-copy"),
      label: "La Jinn",
      action: "select" as const,
      card: {
        instanceId: cardInstanceId(`hand-${sequence}`),
        code: cardCode(97590747),
        controller: 0 as const,
        location: "hand" as const,
        sequence,
      },
    })),
    minimum: 1,
    maximum: 1,
    cancelable: false,
    ordered: false,
  };
}
