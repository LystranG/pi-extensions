import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import mvnOutputExtension from "../src/index.ts";

describe("Maven output extension", () => {
  test("registers only the AI-facing Maven tool", () => {
    let registeredToolName = "";
    const fakePi = {
      registerTool(tool: { name: string }) {
        registeredToolName = tool.name;
      },
    } satisfies Pick<ExtensionAPI, "registerTool">;

    mvnOutputExtension(fakePi);

    expect(registeredToolName).toBe("mvn");
  });
});
