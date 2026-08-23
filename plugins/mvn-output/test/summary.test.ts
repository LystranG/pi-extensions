import { describe, expect, test } from "bun:test";
import { summarizeMavenOutput } from "../src/summary.ts";

describe("Maven output summary", () => {
  test("keeps successful output compact", () => {
    const summary = summarizeMavenOutput({
      args: ["clean", "test"],
      status: "completed",
      executable: "./mvnw",
      cwd: "/workspace",
      exitCode: 0,
      signal: null,
      output: "[INFO] Tests run: 4, Failures: 0, Errors: 0, Skipped: 1\n[INFO] Total time: 2.345 s\n",
      durationMs: 2345,
      logPath: "/tmp/maven.log",
    });

    expect(summary.status).toBe("passed");
    expect(summary.text).toContain("PASS");
    expect(summary.text).toContain("2.345 s");
    expect(summary.text).not.toContain("Tests run:");
  });

  test("classifies compiler and test failures and points to reports", () => {
    const summary = summarizeMavenOutput({
      args: ["test"],
      status: "completed",
      executable: "./mvnw",
      cwd: "/workspace",
      exitCode: 1,
      signal: null,
      output: [
        "[ERROR] /workspace/src/main/java/App.java:[42,17] cannot find symbol",
        "[ERROR]   symbol:   variable missing",
        "[ERROR] UserTest.testCreate <<< FAILURE!",
        "[ERROR] java.lang.AssertionError: expected 200 but was 500",
        "[INFO] Reactor Summary:",
      ].join("\n"),
      durationMs: 1000,
      logPath: "/workspace/.agent-logs/maven/maven.log",
      reportPaths: ["/workspace/target/surefire-reports"],
    });

    expect(summary.status).toBe("failed");
    expect(summary.text).toContain("Compiler");
    expect(summary.text).toContain("Test");
    expect(summary.text).toContain("target/surefire-reports");
    expect(summary.details.findings.length).toBeGreaterThanOrEqual(2);
  });

  test("falls back to bounded head and tail for unknown failures", () => {
    const summary = summarizeMavenOutput({
      args: ["verify"],
      status: "completed",
      executable: "mvn",
      cwd: "/workspace",
      exitCode: 1,
      signal: null,
      output: ["custom failure", ...Array.from({ length: 100 }, (_, index) => `line ${index}`)].join("\n"),
      durationMs: 100,
      logPath: "/tmp/maven.log",
    });

    expect(summary.text).toContain("UNKNOWN_OUTPUT");
    expect(summary.text).toContain("custom failure");
    expect(summary.text).toContain("line 99");
    expect(summary.text.length).toBeLessThanOrEqual(8192);
  });
});
