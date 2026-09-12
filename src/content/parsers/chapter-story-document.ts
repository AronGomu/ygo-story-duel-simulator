import type {
  ChapterChoiceId,
  ChapterStoryDocument,
} from "../contracts/chapter-story-document.ts";
import type { ContentResult } from "../contracts/content-result.ts";
import {
  array,
  invalid,
  literal,
  packId,
  record,
  result,
  safePath,
  text,
  unique,
} from "./schema.ts";

const choiceIds = ["trust-rin", "challenge-rin", "observe-first"] as const;

function choiceRecord(
  value: unknown,
): Readonly<Record<ChapterChoiceId, string>> {
  const choices = record(value, choiceIds);
  return {
    "trust-rin": text(choices["trust-rin"]),
    "challenge-rin": text(choices["challenge-rin"]),
    "observe-first": text(choices["observe-first"]),
  };
}

export function parseChapterStoryDocument(
  value: unknown,
): ContentResult<ChapterStoryDocument> {
  return result(value, 4194304, (value) => {
    const story = record(value, [
      "schemaVersion",
      "contentId",
      "title",
      "beats",
      "choices",
      "choiceResponses",
      "laterAcknowledgments",
      "mapImage",
    ]);
    const beats = array(story.beats, (value) => {
      const beat = record(value, [
        "id",
        "speaker",
        "kind",
        "text",
        "background",
        "characters",
      ]);
      const characters = array(
        beat.characters,
        (value) => literal(value, "rin-neutral", "rin-smile", "kael"),
        3,
      );
      unique(characters, (character) => character);
      return {
        id: text(beat.id),
        speaker: literal(beat.speaker, "Rin", "Kael", "Protagonist", null),
        kind: literal(beat.kind, "dialogue", "narration", "thought"),
        text: text(beat.text),
        background: literal(beat.background, "station", "concourse", "arena"),
        characters,
      };
    });
    const choices = array(
      story.choices,
      (value) => {
        const choice = record(value, ["id", "label"]);
        return {
          id: literal(choice.id, ...choiceIds),
          label: text(choice.label),
        };
      },
      3,
    );
    unique(beats, (beat) => beat.id);
    unique(choices, (choice) => choice.id);
    if (
      beats.length === 0 ||
      choices.length !== choiceIds.length ||
      choiceIds.some((id) => !choices.some((choice) => choice.id === id))
    )
      invalid();
    const map = record(story.mapImage, ["packId", "path"]);
    return {
      schemaVersion: literal(story.schemaVersion, 1),
      contentId: literal(story.contentId, "prototype-prologue-v1"),
      title: text(story.title),
      beats,
      choices,
      choiceResponses: choiceRecord(story.choiceResponses),
      laterAcknowledgments: choiceRecord(story.laterAcknowledgments),
      mapImage: { packId: packId(map.packId), path: safePath(map.path) },
    };
  });
}
