import { after } from "next/server";

/**
 * 响应后后台任务的统一入口（Issue #40 案例自动重整）。
 *
 * 在 Next 请求作用域内使用 `after()`：响应先返回，任务在响应后执行；
 * 单元/集成测试直接调用路由处理函数时没有请求作用域，`after()` 会同步抛错，
 * 此处退化为立即执行，并允许用例通过 `awaitBackgroundTasksForTests()` 等待完成
 * —— 保证测试断言的是真实完成状态，而不是「也许还没跑完」。
 *
 * 本进程内后台执行符合「不引入 Redis / 后台队列 / 定时批处理」的约束；
 * 进程重启导致任务中断时，持久化的 PENDING/REPROCESSING 状态可被状态查询
 * 识别并安全重试（见 case-process-service）。
 */
const pendingTasks: Promise<void>[] = [];

export function scheduleBackgroundTask(task: () => Promise<void>): void {
  const run = (): void => {
    const started = task().catch((error: unknown) => {
      console.error("[background-task] 未捕获失败：", error);
    });
    pendingTasks.push(started);
  };
  try {
    after(() => {
      void run();
    });
  } catch {
    run();
  }
}

/** 仅测试使用：等待本进程已排入的后台任务结束。 */
export async function awaitBackgroundTasksForTests(): Promise<void> {
  while (pendingTasks.length > 0) {
    const batch = pendingTasks.splice(0, pendingTasks.length);
    await Promise.all(batch);
  }
}
