import { existsSync } from "node:fs";
import { join } from "node:path";

/** 判断当前目录是否包含 Maven 项目描述文件 */
export function isMavenProject(cwd: string): boolean {
  return existsSync(join(cwd, "pom.xml"));
}
