/** Pi Maven custom tool 注册和参数适配 */

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_TIMEOUT_MS } from "./constants.ts";
import { executeMaven } from "./executor.ts";
import { isMavenProject } from "./project.ts";
import type { MavenToolDetails, MavenToolParams } from "./types.ts";

const MavenToolParamsSchema = Type.Object({
  args: Type.Array(Type.String(), {
    description: 'Maven 参数数组，例如 ["clean", "test"]，不要包含 mvn 或 shell 语法',
    minItems: 1,
  }),
  mode: Type.Optional(
    Type.Union([Type.Literal("compact"), Type.Literal("full")], {
      default: "compact",
      description: "compact 返回摘要，full 返回 Maven 原始输出",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Integer({
      minimum: 1_000,
      maximum: 1_800_000,
      default: DEFAULT_TIMEOUT_MS,
      description: "超时时间，单位毫秒",
    }),
  ),
});

/** 注册给 AI 使用的 Maven 工具 */
export function registerMavenTool(pi: Pick<ExtensionAPI, "registerTool">): void {
  pi.registerTool({
    name: "mvn",
    label: "Maven",
    description:
      "仅用于包含 pom.xml 的 Maven 项目。执行当前项目的 ./mvnw，若不存在则执行 PATH 中的 mvn。传入 Maven 参数数组，不要调用 shell 语法。默认压缩输出并保留完整日志路径；需要原始输出时使用 mode=full。",
    promptSnippet: "Run Maven with compact, diagnostic output",
    promptGuidelines: [
      "仅当当前目录包含 pom.xml 时调用此工具",
      "不要把 mvn、./mvnw、管道、重定向或 shell 运算符放进 args",
      "默认使用 compact；失败时先依据摘要和 logPath 诊断",
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
        isError: result.status === "failed",
      };
    },
  });
}
