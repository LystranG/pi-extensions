import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMavenProject } from "../src/project.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Maven project detection", () => {
  test("requires pom.xml in the tool working directory", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-mvn-project-"));
    temporaryDirectories.push(cwd);

    expect(isMavenProject(cwd)).toBe(false);
    await writeFile(join(cwd, "pom.xml"), "<project />");
    expect(isMavenProject(cwd)).toBe(true);
  });
});
