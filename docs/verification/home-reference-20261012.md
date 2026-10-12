# 首页与底部导航对照验证（2026-10-12）

## 范围与对照

先读 `docs/development-plan.md`、`AGENTS.md` 与参考图，再按维护者当轮确认实施。仅修改 `HomeTab`、`HomePage`、首页专用视觉组件及其自制 SVG；共享主题、登录、服务、个人、知识问答与后端代码均未修改。

- 对照首页的大标题、搜索胶囊、金色主视觉、频道胶囊、浅灰蓝底色、四列快捷服务与浅蓝半透明悬浮导航。
- 按课程场景替换文案、插画、图标及导航名称；不是原华为宣传图的逐像素复制。未做像素差异量化，未宣称其他四个页面已还原。
- 客户：`首页｜活动｜服务｜知识｜我的`；工作人员：`首页｜活动｜工作台｜知识｜我的`。
- 活动点击提示未接入；知识打开已有知识问答目的页。分类知识首页、社团活动页、购物与社交均未实现。
- 主页报修与进度入口按角色分流，继续使用服务器会话和接口。没有新增演示业务数据或硬编码查询结果。

## 实际执行

DevEco SDK：`D:/DevEco Studio/sdk`；API 24。设备为 `hdc list targets` 返回的 `127.0.0.1:5555` 模拟器，`const.product.model=emulator`，`const.ohos.fullname=OpenHarmony-6.1.1.125`，截图尺寸 1320×2856。不是实体手机。

在 `app/` 执行：

```powershell
$env:DEVECO_SDK_HOME='D:/DevEco Studio/sdk'
$env:Path='D:/DevEco Studio/tools/node;'+$env:Path
& 'D:/DevEco Studio/tools/hvigor/bin/hvigorw.bat' --mode module -p product=default assembleHap
```

最终构建 `BUILD SUCCESSFUL`，未签名 HAP 1,397,664 字节。编译有 5 处异常处理警告（知识引用、知识问答、服务与首页的提示调用），无编译错误；未配置签名，不能据此保证实体手机安装。

```powershell
hdc install -r app/entry/build/default/outputs/default/entry-default-unsigned.hap
hdc shell aa force-stop cn.zafu.pchospital.course
hdc shell aa start -a EntryAbility -b cn.zafu.pchospital.course -m entry
hdc shell uitest screenCap -p /data/local/tmp/home-final.png
hdc shell uitest dumpLayout -p /data/local/tmp/home-layout.json
```

实际用 SDK 中的 `hdc.exe` 完整路径与 Windows 绝对 HAP 路径安装，返回 `install bundle successfully`；启动返回 `start ability successfully`。通过 `uitest uiInput` 操作、布局转储与截图检查。

| 检查 | 结果 |
| --- | --- |
| 客户会话恢复进入首页 | 成功，看到金色主视觉与五个导航位置 |
| 客户服务导航 | 打开原客户服务页，显示真实开发库设备记录 |
| 知识导航及返回 | 打开现有知识问答页；返回恢复原 Tab |
| 首页搜索 | 打开现有知识问答目的页，返回首页正常 |
| 客户首页「我要报修」 | 打开客户「我的报修」页，没有进入工作人员列表 |
| 我的导航 | 打开原个人页，显示服务端真实测试客户身份与统计 |
| 活动导航 | 原页保留，布局转储捕获「活动模块暂未接入」Toast |
| 客户退出、工作人员登录 | 本地后端健康检查可达，使用既有工作人员测试账号登录成功 |
| 工作人员首页 | 中间导航显示「工作台」，无客户进度区 |
| 工作人员首页「我要报修」 | 打开工作人员报修列表，含待受理 / 我负责 / 全部范围 |
| 工作台导航 | 打开原工作人员服务页，显示报修工作台、知识问答与典型案例入口；普通工作人员不显示审核入口 |

界面检查发现并修正了首版主视觉偏高、搜索圆角未显示、导航底色与参考图不符的问题；以以下最终模拟器截图为准。

`git diff --check`、首页 SVG XML 解析与本次参考/验证文档相对链接存在性检查通过。原工作区的 `app/oh-package-lock.json5` 行尾变化保留，不纳入本次提交。

## 截图

- [客户首页](home-reference-20261012/customer-home.png)
- [工作人员首页](home-reference-20261012/staff-home.png)
- [工作人员工作台入口（原页面，未重构）](home-reference-20261012/staff-workbench.png)

## 未验证范围

未做实体手机、深色模式、大字体或其他屏幕尺寸适配验证；未重复测试完整报修、照片、AI 调用或案例回流链路。本次没有后端改动，未重跑数据库套件与全仓测试。首页搜索暂为问答入口，不代表已实现搜索建议或独立搜索结果页。
