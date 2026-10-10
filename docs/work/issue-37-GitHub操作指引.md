# Issue #37 认领与 PR 操作指引

> 本机无 GitHub 凭据（已实测：`gh` 未安装、无 Token、凭据助手在非交互环境挂起），
> 因此**评论与 PR 需你代为操作**。以下文本可直接复制粘贴。

---

## 第一步：在 Issue #37 下留认领评论

打开 https://github.com/Xiaoyuan-114/zafu-pchospital-harmonyos/issues/37

复制以下内容贴到评论区：

```markdown
**认领 Issue #37（02 客户报修与进度查询）**

- 认领人：@Sek1ro-oka
- 开始时间：2026-10-10
- 预计分支：`feat/issue-37-customer-repair-orders`（从个人仓库 fork 提 PR）

**本次范围**：客户报修单的提交、本人列表、详情与进度查询。
新建 `RepairOrder` / `RepairOrderEvent` 模型，**不复用** `RepairRecord`
（备案是工作人员对象，与客户报修是两个东西）。#38 的工作人员侧留作后续。

**不包含**：照片上传、客户取消、工作人员受理 —— 分别留给 #38 或单开。

**当前状态**：已核查代码现状（后端无任何客户报修实现），方案设计完成，
开工前有一个技术决策点待定（客户账号的权限来源），完成后同步进度。

**请其他协作者注意**：本 Issue 已认领，如你也计划做客户报修请在此评论，
避免重复开发。
```

> 若仓库支持，建议同时把自己设为 **Assignee**（页面右侧 Assignees → 选自己）。

---

## 第二步：等待确认后开工

留评论后告诉我，我开始写代码。分支名：
`feat/issue-37-customer-repair-orders`

---

## 第三步：提交与开 PR（代码完成后）

代码通过验证后，我会：
1. 在本地建分支、提交
2. 推送到 `origin`（`Sek1ro-oka/zafu-pchospital-harmonyos`）
   —— ⚠️ 这一步同样需要凭据，**可能会弹交互窗口**，届时请你在弹出的窗口里登录
3. 给你开 PR 的完整指引（或你在 GitHub 页面上直接点 "Compare & pull request"）

**PR 标题建议**：
```
feat(repair-orders): 客户报修提交、本人列表与进度查询 (#37)
```

**PR 描述模板**（代码完成后我会补全实测证据）：
```markdown
Closes #37

## 做了什么
- 新增 `RepairOrder` / `RepairOrderEvent` 模型与迁移（与 `RepairRecord` 分离）
- 新增 `POST/GET /api/v1/repair-orders` 与 `GET /api/v1/repair-orders/[id]`
- App：客户报修列表、提交表单、详情与进度（加载/空/失败/重试四态）

## 没做什么（留后续）
- 照片上传、客户取消、工作人员受理 → #38

## 验证证据
（待补：迁移、提交、查询、越权、测试、lint、HAP 构建、Previewer）
```

---

## 备选：如果你愿意提供 Token

在 https://github.com/settings/tokens 生成一个 **classic token**，勾 `public_repo`
（或 fine-grained 勾 `Issues: Read and write` + `Pull requests: Read and write`），
贴给我，我就能代你完成评论与 PR。凭据**只用于本次操作，不写入任何文件**。
用完你可以在 GitHub 上一键 Revoke。
