/** pi-subagents 在托管子会话的进程里写入的环境变量名 */
const SUBAGENT_CHILD_ENV = "PI_SUBAGENT_CHILD";

/**
 * 判断当前进程是否由 pi-subagents 的后台 runner 托管，也就是子代理会话所在的进程
 * 该变量由 runner 在加载扩展之前写入，因此扩展工厂执行时就能读到
 */
export function isSubagentChildProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SUBAGENT_CHILD_ENV] === "1";
}
