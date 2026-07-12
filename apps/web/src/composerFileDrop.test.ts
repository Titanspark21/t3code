import { describe, expect, it } from "vite-plus/test";
import {
  buildDroppedFileBlock,
  codeFenceFor,
  looksBinary,
  MAX_COMPOSER_FILE_BYTES,
  MAX_COMPOSER_FILES,
  readDroppedFilesAsBlocks,
  type DroppedFileLike,
} from "./composerFileDrop.ts";

function fakeFile(name: string, content: string, sizeOverride?: number): DroppedFileLike {
  return {
    name,
    size: sizeOverride ?? content.length,
    text: () => Promise.resolve(content),
  };
}

describe("looksBinary", () => {
  it("treats plain text as text", () => {
    expect(looksBinary("# Title\n\nsome markdown")).toBe(false);
    expect(looksBinary("")).toBe(false);
  });

  it("flags NUL bytes and replacement-character noise as binary", () => {
    expect(looksBinary(`abc${String.fromCharCode(0)}def`)).toBe(true);
    expect(looksBinary(String.fromCharCode(0xfffd).repeat(20))).toBe(true);
  });
});

describe("codeFenceFor", () => {
  it("uses three backticks for fence-free content", () => {
    expect(codeFenceFor("plain content")).toBe("```");
  });

  it("escalates past the longest internal backtick run", () => {
    expect(codeFenceFor("has ``` fence")).toBe("````");
    expect(codeFenceFor("has ```` fence")).toBe("`````");
  });
});

describe("buildDroppedFileBlock", () => {
  it("labels the block with the file name and wraps the content", () => {
    const block = buildDroppedFileBlock("notes.md", "hello");
    expect(block).toContain("notes.md:");
    expect(block).toContain("```\nhello\n```");
  });

  it("keeps content readable when it already contains a code fence", () => {
    const block = buildDroppedFileBlock("readme.md", "```js\ncode\n```");
    expect(block).toContain("````");
  });
});

describe("readDroppedFilesAsBlocks", () => {
  it("produces one block per readable text file", async () => {
    const result = await readDroppedFilesAsBlocks([
      fakeFile("a.md", "alpha"),
      fakeFile("b.txt", "beta"),
    ]);
    expect(result.error).toBeNull();
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]).toContain("a.md:");
    expect(result.blocks[1]).toContain("b.txt:");
  });

  it("rejects oversized files with an error and no block", async () => {
    const result = await readDroppedFilesAsBlocks([
      fakeFile("huge.log", "x", MAX_COMPOSER_FILE_BYTES + 1),
    ]);
    expect(result.blocks).toHaveLength(0);
    expect(result.error).toMatch(/larger than/i);
  });

  it("rejects binary files", async () => {
    const result = await readDroppedFilesAsBlocks([
      fakeFile("blob.bin", `data${String.fromCharCode(0)}more`),
    ]);
    expect(result.blocks).toHaveLength(0);
    expect(result.error).toMatch(/binary/i);
  });

  it("caps the number of inlined files", async () => {
    const files = Array.from({ length: MAX_COMPOSER_FILES + 2 }, (_unused, index) =>
      fakeFile(`f${index}.txt`, "content"),
    );
    const result = await readDroppedFilesAsBlocks(files);
    expect(result.blocks).toHaveLength(MAX_COMPOSER_FILES);
    expect(result.error).toMatch(/up to/i);
  });

  it("respects the already-inlined count", async () => {
    const result = await readDroppedFilesAsBlocks([fakeFile("a.txt", "a")], MAX_COMPOSER_FILES);
    expect(result.blocks).toHaveLength(0);
    expect(result.error).toMatch(/up to/i);
  });
});
