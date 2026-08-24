/** Pi Maven custom tool 注册和参数适配 */

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_TIMEOUT_MS } from "./constants.ts";
import { executeMaven } from "./executor.ts";
import { analyzeMavenArguments } from "./options.ts";
import { isMavenProject } from "./project.ts";
import type { MavenToolDetails, MavenToolParams } from "./types.ts";

const MavenToolParamsSchema = Type.Object({
  args: Type.Array(Type.String(), {
    description: 'Maven argument array, for example ["clean", "test"]; do not include mvn or shell syntax',
    minItems: 1,
  }),
  mode: Type.Optional(
    Type.Union([Type.Literal("compact"), Type.Literal("full")], {
      default: "compact",
      description: "compact returns a summary; full returns raw Maven output",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Integer({
      minimum: 1_000,
      maximum: 1_800_000,
      default: DEFAULT_TIMEOUT_MS,
      description: "Timeout in milliseconds",
    }),
  ),
});

/** 注册给 AI 使用的 Maven 工具 */
export function registerMavenTool(pi: Pick<ExtensionAPI, "registerTool">): void {
  pi.registerTool({
    name: "mvn",
    label: "Maven",
    description:
      "Use only for Maven projects containing pom.xml. Run ./mvnw from the current project when available, otherwise use mvn from PATH. Pass a Maven argument array and do not use shell syntax. Output is compact by default and includes the full log path; use mode=full when raw output is needed.",
    promptSnippet: "Run Maven with compact, diagnostic output",
    promptGuidelines: [
      "Call this tool only when the current directory contains pom.xml",
      "Do not put mvn, ./mvnw, pipes, redirects, or shell operators in args",
      "Use compact by default; diagnose failures from the summary and logPath first",
    ],
    parameters: MavenToolParamsSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const toolParams: MavenToolParams = params;
      if (!isMavenProject(ctx.cwd)) {
        const details: MavenToolDetails = {
          status: "failed",
          exitCode: null,
          signal: null,
          durationMs: 0,
          executable: "",
          args: [...toolParams.args],
          cwd: ctx.cwd,
          logPath: "",
          findings: [{ kind: "invocation", message: "pom.xml not found; this is not a Maven project" }],
          reportPaths: [],
          warningCount: 0,
          argumentAnalysis: analyzeMavenArguments(toolParams.args),
        };
        return {
          content: [{ type: "text", text: "Maven tool skipped: pom.xml was not found in the current directory." }],
          details,
          isError: true,
        };
      }
      const mode = toolParams.mode ?? "compact";
      const result = await executeMaven(ctx.cwd, toolParams.args, mode, toolParams.timeoutMs, signal);
      if (result.status === "full") {
        return {
          content: [{ type: "text", text: result.text }],
          details: {
            status: "full",
            exitCode: result.execution.exitCode,
            logPath: result.execution.logPath,
          },
          isError: result.execution.status !== "completed" || result.execution.exitCode !== 0,
        };
      }
      return {
        content: [{ type: "text", text: result.text }],
        details: result.details satisfies MavenToolDetails,
        isError: ["failed", "incomplete", "unknown"].includes(result.status),
      };
    },
  });
}
