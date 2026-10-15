# 三个参考页面还原与模拟器验证

2026-10-14。分支 `feat/reference-three-pages-20261014`，从包含图片命名 PR #72 的 `main b7998f8` 开始。按维护者要求，实施图片索引中的三个推荐映射，完成后保留模拟器供维护者审查。

## 实际范围

| 参考图 | 本次改造 | 保留的真实业务 |
| --- | --- | --- |
| [账号资料面板](../reference/my-huawei/account-profile-sheet.jpg) | 个人资料大圆角面板、居中头像/名称/联系方式、个人信息卡、圆形关闭按钮 | 客户昵称/电话、成员本人资料/技能与内部只读资料；原编辑表单收进「个人信息」，保存/版本/权限规则保持 |
| [订单空态](../reference/my-huawei/shopping-orders-empty-state.jpg) | 客户报修与工作人员报修列表的标题、状态/范围筛选、说明条、圆角列表卡、居中空态插画 | 客户真实状态过滤、工作人员公共队列/本人/全部范围、分页、失败重试、报修表单和详情进度；RepairOrder 与 RepairRecord 仍独立 |
| [检测与帮助](../reference/my-huawei/service-diagnostics-help.jpg) | 知识与帮助页的留白、橙色盾牌、蓝色主按钮、灰色线框图标和折叠分类卡 | 真实指南分类/标题检索、指南原文跳转、授权案例入口；AI 问诊仍打开独立对话页，不声明自动硬件检测 |

布局按参考图核对并在模拟器调整尺寸；品牌文案、用户资料、类别和订单状态使用电脑医院实际业务。默认头像与空态/分类图标为项目 SVG；没有把整张参考图或其中账号资料当作业务 UI。知识页仍保留五栏导航，其余四个主页面没有重新设计。

客户筛选新增请求代次及状态快照，防止旧分页混入新范围；首次请求期间的提交刷新仍排队执行。只有这两个受影响的并发场景新增回归，不扩展全仓审计。

## 必要检查

| 检查 | 实际结果 |
| --- | --- |
| `ohpm install` | 成功；自动改动的本分支锁文件仅换行变化，已恢复，原 DevEco 工程的未提交锁文件未动 |
| `hvigorw --mode module -p product=default assembleHap` | 最终 BUILD SUCCESSFUL；4 条既有 PromptAction 异常处理警告，未签名 |
| 三个相关单测文件 | 18/18 通过：资料 6、游客/导航 9、报修刷新/筛选 3（新增 2） |
| 修改测试文件的 ESLint | exit 0 |
| `git diff --check` | 通过 |
| HAP 安装/启动 | `install bundle successfully`、`start ability successfully` |

最终 HAP：`app/entry/build/default/outputs/default/entry-default-unsigned.hap`；SHA256 `58CC2CC23AB425FC67C70456E0F22831EE5B9C78F849F61C5936F11A0669F434`。

```powershell
# app/ 下构建
$env:DEVECO_SDK_HOME='D:/DevEco Studio/sdk'
$env:Path='D:/DevEco Studio/tools/node;'+$env:Path
& 'D:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap

# backend/ 下必要回归
node --import tsx --test tests/unit/personal-profile-app.test.ts tests/unit/repair-orders-app-refresh.test.ts tests/unit/guest-login-app.test.ts
node node_modules/eslint/bin/eslint.js tests/unit/repair-orders-app-refresh.test.ts
```

## 模拟器与本地后端

- DevEco 已安装的 Pura 90，`hdc 127.0.0.1:5555`，1320×2856、API 24；设备实际版本命令返回 `emulator 6.1.0.126(SP1DEVC00E120R4P11)`，不采用旧验证记录的版本值。
- 本轮使用 `hdc shell uitest` 布局转储、点击、输入、滑动及原始截图；没有实体手机验证。
- App 保留已有开发连接 `http://10.0.2.2:13088`，对应本机独立课设库 `pchospital_exp_issue61_1013`。本轮启动已有 #61 第三批后端 `ae39061` 的生产构建，仅为这些既有接口的 UI 验收；未将其宣称为最新 main 后端的完整验收。
- 共享健康接口可达，但实际客户资料路径 `/api/v1/customer/profile` 返回 404，因此没有用共享服务冒充本次资料验证。未部署服务器、未迁移或重置数据库、未调用收费模型。
- 电脑重启后本地 MySQL 和模拟器未运行，已启动现有实例/模拟器并恢复本地后端；没有重建或删除原数据。

## 实际操作与截图

| 页面 / 操作 | 结果与证据 |
| --- | --- |
| 客户个人资料 | 读取真实测试账号昵称/电话，打开信息表单，原值保存成功；[面板](three-reference-pages/customer-profile.png)、[保存反馈](three-reference-pages/customer-profile-edit.png) |
| 成员个人资料 | 读取真实成员昵称/QQ，个人信息内仍显示本人字段及技能编辑；[面板](three-reference-pages/staff-profile.png)、[字段/技能](three-reference-pages/staff-profile-edit.png) |
| 客户报修 | 全部显示本机现有 3 张单；切换已完成只显示完成单，维修中为真实空态；打开/收起原报修表单；[列表](three-reference-pages/customer-orders.png)、[空态](three-reference-pages/customer-orders-empty.png) |
| 工作人员报修 | 待受理显示现有公共队列和未建档提示，原详情入口保留；[列表](three-reference-pages/staff-orders.png) |
| 知识与帮助 | 灰色故障分类卡可展开系统软件指南，打开「操作系统与文件系统」原文；主按钮进入现有知识问答页，未发送问题；[首屏](three-reference-pages/knowledge-help.png)、[展开/滚动](three-reference-pages/knowledge-category.png) |

截图里的 Customer61、Staff61、测试电话及报修是本机已有课设样本，不是生产数据，也不是为布局硬编码的业务结果。资料保存测试保留原值；未新增或推进报修单。

## 留给维护者审查

最终安装以上 HAP，保持模拟器与本地后端运行。可从「我的 → 个人资料」「我的 → 我的报修」（工作人员为进入工作台）和底栏「知识」进入三个页面。未合并到 main。

未验证：实体手机、其他屏幕/字体缩放、完整 AI 模型问答、完整新建报修提交链；本轮不修改这些业务逻辑。视觉还原由维护者在当前模拟器对照确认，不把编译成功当作像素一致或业务全部完成。
