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
    expect(summary.text).toContain("Executable: ./mvnw");
    expect(summary.text).toContain("Args: clean test");
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
    expect(summary.text).toContain("Exit code: 1");
    expect(summary.details.findings.length).toBeGreaterThanOrEqual(2);
  });

  test("does not report PASS when Maven ignores test failures", () => {
    const summary = summarizeMavenOutput({
      args: ["test", "-DtestFailureIgnore=true"],
      status: "completed",
      executable: "./mvnw",
      cwd: "/workspace",
      exitCode: 0,
      signal: null,
      output: "[ERROR] Tests run: 37, Failures: 0, Errors: 20, Skipped: 0\n[INFO] BUILD SUCCESS\n",
      durationMs: 1000,
      logPath: "/workspace/.agent-logs/maven/maven.log",
    });

    expect(summary.status).toBe("failed");
    expect(summary.text).toContain("FAIL");
    expect(summary.text).toContain("20 errors");
    expect(summary.text).toContain("Exit code: 0");
  });

  test("reports skipped tests as NOT_RUN", () => {
    const summary = summarizeMavenOutput({
      args: ["-DskipTests=true", "test"],
      status: "completed",
      executable: "./mvnw",
      cwd: "/workspace",
      exitCode: 0,
      signal: null,
      output: "[INFO] Tests are skipped.\n[INFO] BUILD SUCCESS\n",
      durationMs: 1000,
      logPath: "/workspace/.agent-logs/maven/maven.log",
    });

    expect(summary.status).toBe("not-run");
    expect(summary.text).toContain("NOT_RUN");
  });

  test("does not report PASS when quiet output has no test evidence", () => {
    const summary = summarizeMavenOutput({
      args: ["-q", "test"],
      status: "completed",
      executable: "./mvnw",
      cwd: "/workspace",
      exitCode: 0,
      signal: null,
      output: "",
      durationMs: 1000,
      logPath: "/workspace/.agent-logs/maven/maven.log",
    });

    expect(summary.status).toBe("unknown");
    expect(summary.text).toContain("UNKNOWN");
  });

  test("treats a full Failsafe verify goal as a test-bearing command", () => {
    const summary = summarizeMavenOutput({
      args: ["org.apache.maven.plugins:maven-failsafe-plugin:3.2.5:verify"],
      status: "completed",
      executable: "./mvnw",
      cwd: "/workspace",
      exitCode: 0,
      signal: null,
      output: "[INFO] BUILD SUCCESS\n",
      durationMs: 1000,
      logPath: "/workspace/.agent-logs/maven/maven.log",
    });

    expect(summary.status).toBe("unknown");
  });

  test("detects fail-never when Maven reports a build failure with exit code zero", () => {
    const summary = summarizeMavenOutput({
      args: ["--fail-never", "verify"],
      status: "completed",
      executable: "./mvnw",
      cwd: "/workspace",
      exitCode: 0,
      signal: null,
      output: "[ERROR] Failed to execute goal fake:plugin:1.0:test\n[INFO] BUILD FAILURE\n",
      durationMs: 1000,
      logPath: "/workspace/.agent-logs/maven/maven.log",
    });

    expect(summary.status).toBe("failed");
    expect(summary.text).toContain("FAIL");
    expect(summary.text).toContain("Exit code: 0");
  });

  test("marks a final passing retry as PASS_WITH_FLAKES", () => {
    const summary = summarizeMavenOutput({
      args: ["-Dsurefire.rerunFailingTestsCount=1", "test"],
      status: "completed",
      executable: "./mvnw",
      cwd: "/workspace",
      exitCode: 0,
      signal: null,
      output: "[WARNING] flaky test rerun succeeded\n[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0\n",
      durationMs: 1000,
      logPath: "/workspace/.agent-logs/maven/maven.log",
    });

    expect(summary.status).toBe("passed-with-flakes");
    expect(summary.text).toContain("PASS_WITH_FLAKES");
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
