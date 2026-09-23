import assert from "node:assert/strict";
import test from "node:test";
import { formatTimestamp, parseAnalysis, parseTimestamp } from "../src/lib/presentation.ts";

test("analysis headings become stable workspace sections", () => {
  const result = parseAnalysis("## What the video shows\nA red panel.\n## Timeline\n00:06 blue.\n## Reverse engineering\nA timer is plausible.");
  assert.equal(result.overview, "A red panel.");
  assert.equal(result.timeline, "00:06 blue.");
  assert.equal(result.reverse, "A timer is plausible.");
});

test("timestamps retain seconds and milliseconds for seeking", () => {
  assert.equal(parseTimestamp("[00:12]"), 12);
  assert.equal(parseTimestamp("00:07.833"), 7.833);
  assert.equal(parseTimestamp("01:02:03"), 3723);
  assert.equal(parseTimestamp("not a time"), null);
  assert.equal(formatTimestamp(7.833, true), "00:07.833");
});
