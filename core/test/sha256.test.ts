import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Hex } from "../src/util/sha256";

test("sha256 puro confere com node:crypto (vazio, curto, limites de bloco, acentos, emoji, longo)", () => {
  const casos = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(65), "ação financeira – R$ 1.234,56", "teste \u{1F600}", "x|y|z".repeat(1000)];
  for (const c of casos) assert.equal(sha256Hex(c), createHash("sha256").update(c).digest("hex"), JSON.stringify(c.slice(0, 20)));
});

test("vetores oficiais NIST", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});
