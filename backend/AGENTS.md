# AGENTS.md

先读本目录 README、docs/local-development.md 和 ../docs/development-plan.md；项目级规则见 ../AGENTS.md。前后端同仓，使用根 README 的模块 Issue 记录目标与进度，由团队自行认领和安排，无需固定周计划或另一位成员批准。

- 只修改本课设实验仓库；原 Web、生产数据库与线上服务不得改动。
- 使用原生 Node/Next 和 MySQL，不引入 Docker。按维护者 2026-10-12 授权提供共享实验服务器；依赖安装、测试和构建在本机 WSL/Linux 完成，服务器仅运行上传产物、迁移及课设初始化。遵循 docs/shared-deployment.md 的资源限制。
- 开发 `.env` 留在本机；共享服务器凭证留在服务器私有配置中，不进入 App 或仓库；示例提供配置键和占位值即可。
- 接口位于 `src/app/api/v1`，业务位于 `src/features`，共享能力位于 `src/lib`。修改接口契约时同步客户端说明。
- 开发库与 `_test` 测试库分离。迁移、seed、数据库测试和重置使用标准脚本；保留库名保护。
- `repairDate` 是上海日历日 DATE，API 的 UTC 区间需转换为日历边界后查询。
- 按改动运行适当的 lint、构建和真实测试，记录失败及未验证范围。占位、模拟结果和未装机内容不得写为完成。
- 提交前检查 git status、diff 和 HEAD；不覆盖他人未提交文件，不强推或清理业务代码修复 ref 异常。
