/** Pi Maven 输出插件入口 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMavenTool } from "./tool.ts";

/** 注册 Maven 输出压缩工具 */
export default function mvnOutputExtension(pi: Pick<ExtensionAPI, "registerTool">): void {
  registerMavenTool(pi);
}
