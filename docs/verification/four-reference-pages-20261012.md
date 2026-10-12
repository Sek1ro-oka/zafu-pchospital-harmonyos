# 四个主页面与滑动导航验证（2026-10-12）

分支：`feat/reference-four-tabs-20261012`，基点：`origin/main f17bbb08`。

## 本轮范围

维护者确认：对照四张参考图改造主页面，已有功能接真实接口，缺失功能标明暂未接入；活动复用维修活动 API；使用「我要报修」，不新增预约时段。AI 对话、报修表单、处理/审核详情保持原业务实现。

| 页面 | 对照原图 | 实际模拟器截图 |
| --- | --- | --- |
| 我的 | [② 我的](../reference/my-huawei/my-account-service-record-entry.jpg) | [客户我的](four-reference-pages-20261012/customer-my.png) |
| 知识 | [③ 选购](../reference/my-huawei/shopping-category-navigation.jpg) | [知识首页](four-reference-pages-20261012/knowledge.png) |
| 服务 | [④ 服务](../reference/my-huawei/service-my-products-repair-entry.jpg) | [客户服务](four-reference-pages-20261012/customer-service.png) / [工作人员工作台](four-reference-pages-20261012/staff-workbench.png) |
| 活动 | [⑤ 花粉](../reference/my-huawei/community-huafen-feed.jpg) | [活动空态](four-reference-pages-20261012/activity.png) |

大标题、搜索框、留白、圆角卡、主题横幅、宫格和底栏对照参考图。原宣传商品替换为项目 SVG 插画，客户身份、数量、设备、活动和案例来自实际接口；插画不是现场照片或业务结果。本轮没有做像素差分或宣称原品牌宣传画已逐像素复刻。

## 已实现

- 五个真实根页面，首页｜活动｜服务/工作台｜知识｜我的，保留液态玻璃悬浮底栏；活动与知识新增蓝色选中图标。
- 原生 Tabs 横向滑动，点击和手势均可切换，260ms ease-out；[切换途中截图](four-reference-pages-20261012/slide-frame.png)显示页面滑动时底栏保持固定。
- 游客进入我的在切换前触发登录，取消留在原页；登录按服务器身份续接目标。退出过程中拦截切页，退出完成回游客首页。
- 我的使用实际身份卡、最近一页报修计数、六个客户入口和工作人员入口。客户维修记录暂未接入，没有将报修单改名冒充维修备案。
- 服务使用本人最近一页报修单派生的设备卡，AI、报修、进度、公开指南与近期活动入口；工作人员显示真实工作台及有权限的备案审核入口。
- 知识浏览 15 篇真实公开指南，标题分类与搜索共同过滤，点击指定指南 ID 打开正文。授权工作人员可看最近一页已发布案例、打开已有案例库和详情；客户通过问答引用查看公开案例，不新增公开案例目录。
- 活动读取 `GET /api/v1/repair-activities`，包含搜索、维修活动信息卡与空态。当前共享库返回 0 条活动。公告、经验分享和 App 报名明确暂未接入。

## 实际检查

### 构建与逻辑

在本机 `app/`：

```powershell
$env:DEVECO_SDK_HOME='D:/DevEco Studio/sdk'
$env:Path='D:/DevEco Studio/tools/node;'+$env:Path
& 'D:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
```

- 最终结果：`BUILD SUCCESSFUL`；未签名 HAP，1,663,270 字节。
- SHA256：`B9D7F27CE3ED6822EDBE6EFF5AFE6A79CF0F2A8B0190DC9090EDA06FC5892B88`。
- 4 条 PromptAction 异常处理告警和预期的跳过签名提示，未宣称零告警。
- 初次编译发现案例详情参数缺少必填 title，补齐后构建通过。模拟器检查发现宫格嵌套宽度导致单字截断，以及切换账号后子组件标题/底栏标签滞留，已修正并再次装机确认。

在本机 WSL/Linux 镜像目录（复制本轮实际 App 源码和测试，使用已安装依赖）：

```sh
pnpm exec eslint tests/unit/guest-login-app.test.ts tests/unit/reference-pages-app.test.ts
pnpm exec tsx --test tests/unit/guest-login-app.test.ts tests/unit/reference-pages-app.test.ts
pnpm test:unit
```

- 修改测试文件 lint 通过，针对性检查 **14/14**，完整单测 **458/458**。
- 执行真实页面状态方法，平台与网络用模拟依赖；覆盖游客手势守卫、取消/续接/退出、退出中切页、案例权限与迟到响应隔离、指南分类、活动刷新竞态和页面销毁。
- 没有接口、数据库模型或迁移变更；未重跑数据库套件或后端生产构建。
- 文档相对链接、资源引用与 `git diff --check` 在提交前检查。

### 模拟器操作

设备：`hdc 127.0.0.1:5555`，`OpenHarmony-6.1.1.125`，API 24，1320×2856。

```powershell
hdc install -r app/entry/build/default/outputs/default/entry-default-unsigned.hap
hdc shell aa start -a EntryAbility -b cn.zafu.pchospital.course -m entry
hdc shell uitest uiInput click <x> <y>
hdc shell uitest uiInput swipe <fromX> <fromY> <toX> <toY> 1000
hdc shell uitest dumpLayout -p /data/local/tmp/<name>.json
hdc shell uitest screenCap -p /data/local/tmp/<name>.png
```

实际检查了四页布局/滚动/底栏高亮、客户登录续接我的、同一进程退出并切换工作人员账号、工作人员标题和底栏刷新、工作人员案例空态、公开指南深链、点击/左右手势切换，以及游客从知识滑入我的 → 登录 → 返回仍在知识。

额外证据：[工作人员案例空态](four-reference-pages-20261012/staff-knowledge-cases.png)、[真实指南正文](four-reference-pages-20261012/guide-detail.png)、[手势触发登录](four-reference-pages-20261012/swipe-login.png)。

### 共享 API 的内存软限额问题

约 12:30 联调中，模拟器登录和电脑 HTTPS health 超时；服务器本机 `127.0.0.1:13080/health` 也超时。应用和 MySQL 进程仍 active，服务 NRestarts=0、无 OOM；应用内存回收 pressure avg10=62.36%，原 MemoryHigh=300M 触发持续回收。

仅将实验 API 的持久软限额改为 **360M**（`systemctl set-property pchospital-shared.service MemoryHigh=360M`），硬上限保持 384M、Node 堆 256 MiB。未重启服务、安装依赖、服务器构建或修改数据库。调整后本机 health 立即 HTTP 200，模拟器重试登录成功；后续 pressure avg10=0.00%，应用约 315 MiB，服务器约 458 MiB 可用，OOM=0、NRestarts=0。仓库部署配置与说明已同步。

[公开接口记录](four-reference-pages-20261012/api-check.json)：活动与指南 HTTP 200，分别 0/15 条。[服务器资源记录](four-reference-pages-20261012/server-check.json)为调整后实际读取，不代表长期负载测试。

## 未验证 / 未实现

- 未用实体手机；不同屏幕、字体缩放、系统减少动态效果开关、连续快速手势与长时间运行未逐项验证。
- 共享库当前无活动或已发布案例，本轮没有往共享库造内容；非空活动卡/案例目录未做设备端真实数据验证。
- 公告、经验分享、活动报名、收藏、消息、个人资料编辑、客户维修备案列表和预约时段尚未接入。
- 不代表完整报修、照片、审核、AI 整理链路完成真机验收；沿用此前各模块的验证范围。
