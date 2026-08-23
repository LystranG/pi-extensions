import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMaven } from "../src/executor.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Maven executor", () => {
  test("prefers an executable project mvnw and preserves the failed log", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-mvn-compact-"));
    temporaryDirectories.push(cwd);
    const wrapper = join(cwd, "mvnw");
    await writeFile(
      wrapper,
      "#!/bin/sh\nprintf '%s\\n' \"$@\"\nprintf '[ERROR] Failed to execute goal fake:plugin:1.0:test\\n'\nexit 1\n",
    );
    await chmod(wrapper, 0o700);

    const result = await runMaven(cwd, ["test"], "compact");

    expect(result.executable).toBe(wrapper);
    expect(result.args.slice(0, 3)).toEqual(["-B", "-ntp", "-Dstyle.color=never"]);
    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(1);
    expect(await readFile(result.logPath, "utf8")).toContain("fake:plugin");
  });
});
