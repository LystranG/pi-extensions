/** Maven 测试报告目录发现策略 */

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const REPORT_DIRECTORY_NAMES = new Set(["surefire-reports", "failsafe-reports"]);
const MAX_SCAN_DEPTH = 8;

/** 发现 Maven 测试报告目录但不读取报告内容 */
export async function discoverMavenReportPaths(cwd: string): Promise<string[]> {
  const paths: string[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH) return;
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      await Promise.all(
        entries.map(async (entry) => {
          if (entry.name === "node_modules" || entry.name === ".git") return;
          const entryPath = join(directory, entry.name);
          if (entry.isDirectory()) {
            if (REPORT_DIRECTORY_NAMES.has(entry.name)) {
              paths.push(relative(cwd, entryPath));
              return;
            }
            await visit(entryPath, depth + 1);
          }
        }),
      );
    } catch {
      return;
    }
  }

  await visit(cwd, 0);
  return paths.sort();
}
