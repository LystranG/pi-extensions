import { describe, expect, test } from "bun:test";
import { buildMavenArguments, shouldUseFullOutput } from "../src/command.ts";

describe("Maven command planning", () => {
  test("adds compact flags without overriding explicit Maven flags", () => {
    expect(buildMavenArguments(["clean", "test"], "compact")).toEqual([
      "-B",
      "-ntp",
      "-Dstyle.color=never",
      "clean",
      "test",
    ]);
    expect(
      buildMavenArguments(["--batch-mode", "--no-transfer-progress", "-Dstyle.color=always", "test"], "compact"),
    ).toEqual(["--batch-mode", "--no-transfer-progress", "-Dstyle.color=always", "test"]);
  });

  test("does not inject flags in full mode", () => {
    expect(buildMavenArguments(["clean", "verify"], "full")).toEqual(["clean", "verify"]);
  });

  test("uses full output for information and report goals", () => {
    expect(shouldUseFullOutput(["--version"])).toBe(true);
    expect(shouldUseFullOutput(["help:effective-pom"])).toBe(true);
    expect(shouldUseFullOutput(["-DskipTests", "dependency:tree"])).toBe(true);
    expect(shouldUseFullOutput(["-Dgoal=help", "test"])).toBe(false);
  });
});
