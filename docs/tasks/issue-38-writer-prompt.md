# Issue #38 写手开工提示词

复制以下内容给写手。完整任务书见 [工作人员处理与维修备案](issue-38-staff-repair-records.md)。

```text
你负责实现“鸿蒙电脑医院”Issue #38：工作人员处理与维修备案。
仓库：https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos

先读 AGENTS.md、backend/AGENTS.md、README.md、docs/development-plan.md、
backend/docs/native-client-api.md，再完整阅读维护者提供的
docs/tasks/issue-38-staff-repair-records.md。本轮按该任务书开发，后续由技术主线审查。
若任务书仍在文档 PR 分支，先读取该分支的任务文件，业务实现仍从最新 origin/main 开始。

建立独立功能分支，建议 feat/issue-38-staff-repairs；保护其他人的工作区。
#37 客户报修已合入，可以直接接；复用课设后端已有 RepairRecord 草稿、编辑、
提交、照片和审核服务，保持原 Web 的业务与 Cookie/Origin 行为。

交付：工作人员队列、受理与进度、时间线、关联备案草稿/编辑/照片上传/提交、
管理员 App 审核列表与详情/通过/退回，以及必要契约和验收记录。
公共队列先受理的人负责，管理员可管理报修；服务端校验权限和归属。
允许先完成报修再补备案，两套状态独立；管理员不能编辑别人的备案。
备案本人只可编辑 DRAFT/REJECTED，提交保留原字段校验且至少一张真实照片。
关联建档、抢单和状态事件处理并发与重复提交，避免多份备案或孤立数据。
原生写请求凭 Bearer + X-Client-Type:native，按真实令牌来源分流，
不能伪造 Origin，也不能放松 Cookie 写请求的同源检查；照片读取同样鉴权。
业务记录审核不等于知识案例发布，#40、转派、多级审批等不在本轮。

只做必要检查：相关权限/状态/并发/关联测试、真实数据库与 API 小链路、
后端 lint/unit/build、HAP 构建和新增页面关键交互；不增加审计框架或复杂流程。
有设备就安装验证，没有就明确未真机验证，构建或模拟不能替代设备证据。
数据库直接用本地 MySQL，保持开发/测试隔离，不用 Docker、不动生产项目。

持续完成可审查成果，普通实现选择自行处理，必要阻碍再集中说明。
同步接口、真实进度和简短验收记录；提交并推送功能分支、创建 PR，Refs #38。
推送已授权，无需再问；不要自行合并、关闭 Issue 或直接推 main。
最终报告分支、提交、PR、实现内容、实际检查结果、未完成与未验证项。
```
