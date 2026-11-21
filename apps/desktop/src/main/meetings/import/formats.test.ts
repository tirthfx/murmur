import { describe, expect, it } from "vitest";
import {
  IMPORT_FORMAT_TEXT,
  MAX_SEGMENTS,
  dateFromFileName,
  parseClock,
  parseJson,
  parseSrt,
  parseText,
  parseTranscriptFile,
  parseVtt,
  splitSpeaker,
} from "./formats";

const segs = (result: ReturnType<typeof parseVtt>) => {
  if (!result.ok) throw new Error(result.message);
  return result.transcript.segments;
};

/** A transcript as Zoom writes it: numbered cues, "Name: words". */
const ZOOM_VTT = `WEBVTT

1
00:00:05.690 --> 00:00:09.570
Dana Lee: Okay, let's start. The goal today is the launch date.

2
00:00:10.100 --> 00:00:14.200
Sam Ortiz: QA found three bugs last week. Two are fixed.

3
00:01:02.000 --> 00:01:05.500
Dana Lee: Thursday the 27th works if the build is out by Friday.
`;

describe("WebVTT", () => {
  it("reads a Zoom transcript with speakers and times", () => {
    const result = parseVtt(ZOOM_VTT);
    expect(result).toMatchObject({
      ok: true,
      transcript: { format: "vtt", timesEstimated: false },
    });
    expect(segs(result)).toEqual([
      {
        startMs: 5_690,
        endMs: 9_570,
        speaker: "Dana Lee",
        text: "Okay, let's start. The goal today is the launch date.",
      },
      {
        startMs: 10_100,
        endMs: 14_200,
        speaker: "Sam Ortiz",
        text: "QA found three bugs last week. Two are fixed.",
      },
      {
        startMs: 62_000,
        endMs: 65_500,
        speaker: "Dana Lee",
        text: "Thursday the 27th works if the build is out by Friday.",
      },
    ]);
  });

  it("reads voice tags, other tags, entities, cue settings, short times, NOTE and STYLE blocks", () => {
    const text = `\uFEFFWEBVTT - a title

NOTE this is a comment

STYLE
::cue { color: red }

intro
01:02.500 --> 01:04.000 align:start position:0%
<v Priya>Fish &amp; <i>chips</i> <00:01:03.000><c>now</c></v>

00:01:05.000 --> 00:01:06.000
no speaker here
second line
`;
    expect(segs(parseVtt(text))).toEqual([
      { startMs: 62_500, endMs: 64_000, speaker: "Priya", text: "Fish & chips now" },
      { startMs: 65_000, endMs: 66_000, speaker: null, text: "no speaker here second line" },
    ]);
  });

  it("does not take a sentence with a colon for a speaker", () => {
    const text =
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nNote that the budget is: not approved.\n\n00:00:03.000 --> 00:00:04.000\nThe plan is: ship it.\n";
    expect(segs(parseVtt(text)).map((s) => s.speaker)).toEqual([null, null]);
  });

  it.each([
    ["no cues", "WEBVTT\n\nNOTE nothing here\n"],
    ["a cue that ends before it starts", "WEBVTT\n\n00:00:09.000 --> 00:00:01.000\nhello\n"],
    ["nothing", ""],
  ])("refuses a file with %s", (_label, text) => {
    expect(parseVtt(text)).toMatchObject({ ok: false });
  });
});

describe("SubRip", () => {
  it("reads numbered blocks with comma times, and speaker prefixes", () => {
    const text =
      "1\r\n00:00:01,500 --> 00:00:03,000\r\nDana: Hello there.\r\n\r\n2\r\n00:00:03,500 --> 00:00:05,000\r\n<i>General</i> Kenobi\r\nand more\r\n";
    expect(segs(parseSrt(text))).toEqual([
      { startMs: 1_500, endMs: 3_000, speaker: "Dana", text: "Hello there." },
      { startMs: 3_500, endMs: 5_000, speaker: null, text: "General Kenobi and more" },
    ]);
    expect(parseSrt(text)).toMatchObject({ transcript: { format: "srt" } });
  });
});

describe("plain text", () => {
  it("reads Zoom's text export: [Name] time, then the words", () => {
    const text =
      "[Dana Lee] 00:00:05\nOkay, let's start.\nThe goal is the launch date.\n\n[Sam Ortiz] 00:00:12\nQA found three bugs.\n";
    const result = parseText(text);
    expect(result).toMatchObject({
      ok: true,
      transcript: { format: "text", timesEstimated: false },
    });
    expect(segs(result)).toEqual([
      {
        startMs: 5_000,
        endMs: 12_000,
        speaker: "Dana Lee",
        text: "Okay, let's start. The goal is the launch date.",
      },
      {
        startMs: 12_000,
        endMs: 12_000 + Math.max(1_500, 4 * 400),
        speaker: "Sam Ortiz",
        text: "QA found three bugs.",
      },
    ]);
  });

  it.each([
    ["00:00:05 Dana Lee: Hello", "Dana Lee", "Hello", 5_000],
    ["[00:00:05] Dana Lee: Hello", "Dana Lee", "Hello", 5_000],
    ["(1:05) Dana Lee: Hello", "Dana Lee", "Hello", 65_000],
    ["Dana Lee (00:00:05): Hello", "Dana Lee", "Hello", 5_000],
    ["Dana Lee [00:05]: Hello", "Dana Lee", "Hello", 5_000],
  ])("reads the time in %s", (line, speaker, words, at) => {
    const result = parseText(`${line}\n${line.replace(/Hello/, "Again")}x`);
    expect(segs(result)[0]).toMatchObject({ startMs: at, speaker, text: words });
  });

  it("estimates times when the file has none, and says so", () => {
    const result = parseText(
      "Dana: Hello everyone, welcome to the planning call.\nSam: Thanks Dana.\nSecond line from Sam.\n",
    );
    expect(result).toMatchObject({ ok: true, transcript: { timesEstimated: true } });
    const list = segs(result);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ startMs: 0, speaker: "Dana" });
    expect(list[1]).toMatchObject({ speaker: "Sam", text: "Thanks Dana. Second line from Sam." });
    expect(list[1]!.startMs).toBe(list[0]!.endMs);
    expect(list.every((s) => s.endMs > s.startMs)).toBe(true);
  });

  it.each([
    [
      "a paragraph with no speakers",
      "This is just a paragraph of notes.\nAnother line of notes.\n",
    ],
    ["some lines timed and some not", "00:00:01 Dana: one\nSam: two\n"],
    ["nothing", "\n\n"],
    ["a line before any speaker", "Preamble text\nDana: hi\n"],
  ])("refuses %s", (_label, text) => {
    expect(parseText(text)).toMatchObject({ ok: false });
  });
});

describe("JSON", () => {
  it("reads a segments list with times in seconds, a title and a date", () => {
    const text = JSON.stringify({
      title: "Roadmap review",
      startedAt: "2026-11-21T10:00:00Z",
      segments: [
        { start: 0.5, end: 3.25, speaker: "Dana", text: "Hello." },
        { start: 4, end: 6, speaker_name: "Sam", content: "Hi!" },
        { start: 7, text: "No speaker, no end" },
      ],
    });
    const result = parseJson(text);
    expect(result).toMatchObject({
      ok: true,
      transcript: {
        format: "json",
        title: "Roadmap review",
        startedAt: Date.UTC(2026, 10, 21, 10),
        timesEstimated: false,
      },
    });
    expect(segs(result)).toEqual([
      { startMs: 500, endMs: 3_250, speaker: "Dana", text: "Hello." },
      { startMs: 4_000, endMs: 6_000, speaker: "Sam", text: "Hi!" },
      {
        startMs: 7_000,
        endMs: 7_000 + 1_600,
        speaker: null,
        text: "No speaker, no end",
      },
    ]);
  });

  it("reads milliseconds in startMs and endMs, and a list on its own", () => {
    const text = JSON.stringify([
      { startMs: 1000, endMs: 2500, speaker: "Dana", text: "Hello." },
      { start_ms: 3000, end_ms: 4000, text: "There." },
    ]);
    expect(segs(parseJson(text))).toEqual([
      { startMs: 1_000, endMs: 2_500, speaker: "Dana", text: "Hello." },
      { startMs: 3_000, endMs: 4_000, speaker: null, text: "There." },
    ]);
  });

  it.each([
    ["JSON that is not a list of segments", '{"hello": "world"}'],
    ["an empty list", '{"segments": []}'],
    ["a segment with no text", '{"segments": [{"start": 1}]}'],
    ["a segment with no time", '{"segments": [{"text": "hi"}]}'],
    ["a segment that is not an object", '{"segments": ["hi"]}'],
    ["text that is not JSON", "{broken"],
  ])("refuses %s", (_label, text) => {
    expect(parseJson(text)).toMatchObject({ ok: false });
  });

  it("skips a segment with only spaces, and refuses a file of nothing else", () => {
    expect(
      segs(parseJson('{"segments":[{"start":0,"text":"  "},{"start":1,"text":"hi"}]}')),
    ).toHaveLength(1);
    expect(parseJson('{"segments":[{"start":0,"text":"  "}]}')).toMatchObject({ ok: false });
  });

  it("refuses more lines than it will read", () => {
    const many = {
      segments: Array.from({ length: MAX_SEGMENTS + 1 }, (_, i) => ({ start: i, text: "x" })),
    };
    expect(parseJson(JSON.stringify(many))).toMatchObject({ ok: false });
  });
});

describe("which parser", () => {
  it("picks by the start of the file and by its name", () => {
    expect(parseTranscriptFile(ZOOM_VTT, "meeting.vtt")).toMatchObject({
      ok: true,
      transcript: { format: "vtt" },
    });
    expect(parseTranscriptFile(ZOOM_VTT, "no-extension")).toMatchObject({
      ok: true,
      transcript: { format: "vtt" },
    });
    expect(parseTranscriptFile('{"segments":[{"start":0,"text":"hi"}]}', "x.txt")).toMatchObject({
      transcript: { format: "json" },
    });
    expect(parseTranscriptFile("1\n00:00:01,000 --> 00:00:02,000\nhi\n", "x")).toMatchObject({
      transcript: { format: "srt" },
    });
    expect(parseTranscriptFile("Dana: hello\nSam: hi\n", "notes.txt")).toMatchObject({
      transcript: { format: "text" },
    });
  });

  it("refuses what is none of them, naming the formats it can read", () => {
    const result = parseTranscriptFile("just a note", "note.txt");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      for (const text of Object.values(IMPORT_FORMAT_TEXT)) expect(result.message).toContain(text);
    }
    expect(parseTranscriptFile("\u0000\u0001binary", "x.bin")).toMatchObject({ ok: false });
  });
});

describe("helpers", () => {
  it.each([
    ["00:00:05.690", 5_690],
    ["1:02", 62_000],
    ["01:02:03,5", 3_723_500],
    ["12:75", null],
    ["nope", null],
  ])("reads the time %s", (text, ms) => {
    expect(parseClock(text)).toBe(ms);
  });

  it("splits a speaker from the words only for a name", () => {
    expect(splitSpeaker("Dana Lee: Hello")).toEqual({ speaker: "Dana Lee", text: "Hello" });
    expect(splitSpeaker("Speaker 1: Hello")).toEqual({ speaker: "Speaker 1", text: "Hello" });
    expect(splitSpeaker("Dana (host): Hello")).toEqual({ speaker: "Dana (host)", text: "Hello" });
    expect(splitSpeaker("Time: 5 minutes left")).toEqual({
      speaker: "Time",
      text: "5 minutes left",
    });
    expect(splitSpeaker("We agreed on this. Then: nothing")).toEqual({
      speaker: null,
      text: "We agreed on this. Then: nothing",
    });
    expect(splitSpeaker("Dana de la Cruz: Hello")).toEqual({
      speaker: "Dana de la Cruz",
      text: "Hello",
    });
    expect(splitSpeaker("one two three four five six: x")).toEqual({
      speaker: null,
      text: "one two three four five six: x",
    });
    expect(splitSpeaker("no colon here")).toEqual({ speaker: null, text: "no colon here" });
  });

  it("finds a date in a file name", () => {
    expect(dateFromFileName("GMT20261121-100000_Recording.transcript.vtt")).toBe(
      Date.UTC(2026, 10, 21, 10, 0, 0),
    );
    expect(dateFromFileName("Design sync 2026-11-21 10.30.txt")).toBe(
      new Date(2026, 10, 21, 10, 30).getTime(),
    );
    expect(dateFromFileName("notes 2026-11-21.txt")).toBe(new Date(2026, 10, 21).getTime());
    expect(dateFromFileName("meeting.vtt")).toBeNull();
  });
});
