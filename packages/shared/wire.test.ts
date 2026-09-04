import { describe, expect, test } from "bun:test";
import { isYouTubeUrl, normalizePin, youTubeEmbedUrl, youTubeId } from "./wire";

describe("youTubeId", () => {
  test("reads every URL shape a teacher can copy out of the app", () => {
    const cases: Array<[string, string]> = [
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"],
      ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://youtu.be/dQw4w9WgXcQ?si=abc123", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
      ["  https://youtu.be/dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
    ];
    for (const [url, id] of cases) expect(youTubeId(url)).toBe(id);
  });

  test("rejects anything we would have to host ourselves", () => {
    // The whole point of the YouTube-only rule: none of these may be saved.
    for (const url of [
      "https://example.com/lecture.mp4",
      "https://cdn.example.com/clip.webm",
      "/uploads/clip.mp4",
      "https://vimeo.com/123456789",
      "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
      "not a url",
      "",
    ]) {
      expect(youTubeId(url)).toBeNull();
      expect(isYouTubeUrl(url)).toBe(false);
    }
  });

  test("rejects a malformed video id even on a real YouTube host", () => {
    expect(youTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(
      youTubeId("https://www.youtube.com/watch?v=way_too_long_id"),
    ).toBeNull();
    expect(youTubeId("https://www.youtube.com/feed/subscriptions")).toBeNull();
  });

  test("embeds through the no-cookie host", () => {
    expect(youTubeEmbedUrl("dQw4w9WgXcQ")).toStartWith(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });
});

describe("normalizePin", () => {
  test("finds the room however the PIN was typed or pasted", () => {
    expect(normalizePin("142 001")).toBe("142001");
    expect(normalizePin(" 142-001\n")).toBe("142001");
  });
});
