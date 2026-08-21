import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

interface PackageManifest {
  name?: string;
  private?: boolean;
  engines?: { node?: string };
  files?: string[];
  dependencies?: Record<string, string>;
  pi?: { extensions?: string[] };
}

const root = process.cwd();
const shouldPack = process.argv.includes("--pack");
const workspaceRoots = ["plugins", "packages"];

function workspaceDirectories(): string[] {
  return workspaceRoots.flatMap((workspaceRoot) => {
    const absoluteRoot = join(root, workspaceRoot);
    if (!existsSync(absoluteRoot)) return [];

    return readdirSync(absoluteRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(absoluteRoot, entry.name, "package.json")))
      .map((entry) => join(absoluteRoot, entry.name));
  });
}

function readManifest(directory: string): PackageManifest {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as PackageManifest;
}

function validatePlugin(directory: string, manifest: PackageManifest): string[] {
  const errors: string[] = [];
  const location = relative(root, directory);

  if (!manifest.name?.startsWith("@lystran/pi-")) {
    errors.push(`${location}: 插件包名必须使用 @lystran/pi- 前缀`);
  }
  if (manifest.private) errors.push(`${location}: 插件包必须可发布`);
  if (manifest.engines?.node !== ">=20") errors.push(`${location}: engines.node 必须为 >=20`);
  if (!manifest.pi?.extensions?.includes("./src/index.ts")) {
    errors.push(`${location}: pi.extensions 必须包含 ./src/index.ts`);
  }
  if (!manifest.files?.includes("src")) errors.push(`${location}: files 必须包含 src`);
  if (!existsSync(join(directory, "src", "index.ts"))) errors.push(`${location}: 缺少 src/index.ts`);

  const piPackages = ["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"];
  for (const packageName of piPackages) {
    if (manifest.dependencies?.[packageName]) {
      errors.push(`${location}: ${packageName} 应声明为 peerDependency 和 devDependency`);
    }
  }

  return errors;
}

function pack(directory: string): string[] {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: directory,
    encoding: "utf8",
  });

  if (result.status === 0) return [];
  return [`${relative(root, directory)}: npm pack --dry-run 失败\n${result.stderr.trim()}`];
}

const directories = workspaceDirectories();
const errors = directories.flatMap((directory) => {
  const manifest = readManifest(directory);
  const packageErrors = directory.startsWith(join(root, "plugins")) ? validatePlugin(directory, manifest) : [];
  return shouldPack ? [...packageErrors, ...pack(directory)] : packageErrors;
});

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`已校验 ${directories.length} 个 workspace package`);
}
