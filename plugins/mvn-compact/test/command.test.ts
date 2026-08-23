import { describe, expect, test } from "bun:test";
import { buildMavenArguments, shouldUseFullOutput } from "../src/command.ts";
import { analyzeMavenArguments } from "../src/options.ts";

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

  test("analyzes test, logging, and reactor semantics without changing arguments", () => {
    const analysis = analyzeMavenArguments([
      "-fae",
      "-T",
      "2C",
      "-pl",
      "app",
      "-am",
      "-DtestFailureIgnore=true",
      "-Dtest=OriginTest",
      "-DskipITs=true",
      "-l",
      "maven.log",
      "test",
    ]);

    expect(analysis.reactorFailureMode).toBe("fail-at-end");
    expect(analysis.threads).toBe("2C");
    expect(analysis.projects).toBe("app");
    expect(analysis.alsoMake).toBe(true);
    expect(analysis.testFailureIgnore).toBe(true);
    expect(analysis.selectedTests).toBe("OriginTest");
    expect(analysis.skipIntegrationTests).toBe(true);
    expect(analysis.userLogFile).toBe("maven.log");
  });

  test("uses the last repeated Maven property value", () => {
    const analysis = analyzeMavenArguments(["-DskipTests=true", "-DskipTests=false", "test"]);

    expect(analysis.skipTests).toBe(false);
  });
});
