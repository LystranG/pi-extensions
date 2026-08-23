// 定义 Serena hook 与 Pi 之间传递的数据契约

export type SerenaHookAction = "activate" | "remind" | "cleanup";
export type SerenaHookInput = Record<string, unknown>;

export interface SerenaHookResult {
  code: number | null;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

export type SerenaHookExecutor = (action: SerenaHookAction, input: SerenaHookInput) => Promise<SerenaHookResult>;
export type SerenaHookWarning = (action: SerenaHookAction, detail: string) => void;
export type SerenaCommandExecutor = (
  command: string,
  args: string[],
  options: { timeout: number },
  input: SerenaHookInput,
) => Promise<SerenaHookResult>;
