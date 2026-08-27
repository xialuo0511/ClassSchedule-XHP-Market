# 强智教务课表导入插件

这是用于适配强智科技教务系统的 XHP Protocol 3 WebUI 插件源码。

- `plugin.json`：插件清单。
- `main.js`：入口设置界面、课表页面工具栏及强智课表解析逻辑。
- `build.ps1` / `build.sh`：构建 `.xhp` 包。
- `dist/qiangzhi-import.xhp`：可直接导入星瀚课程表的构建产物。

WebUI 的页面背景、表单卡片、确认卡片和悬浮工具栏均使用不透明 surface，避免学校页面内容透过插件界面。

Windows 构建：

```powershell
./examples/plugin-qiangzhi/build.ps1
```
默认入口使用 `about:blank`，不会请求 Example Domain。用户可输入 HTTP 或 HTTPS 教务地址；HTTP 仅建议在可信校园内网使用，因为登录内容不会被传输加密。
## 1.1.4 说明

- 允许 HTTP 与 HTTPS 教务地址，并保留 WebView Cookie、第三方 Cookie 和统一认证会话。
- 登录失效时自动推断强智登录入口，避免把成绩查询等业务页误当作登录页反复刷新。
- 使用 `visualViewport` 固定插件工具栏和导入弹窗；即使学校页面按 950px 桌面宽度渲染，按钮仍处于手机可视区域。
- 导入弹窗采用紧凑布局，内容始终限制在手机屏幕内，必要时仅在卡片内部滚动。
- 严格区分“周次(节次)”标签与独立的 `[01-02]节` 文本，节次上限固定为 12，避免把第 16 周误识别成第 16 节。
- 同名且教师相同的课程合并为一门课程，每条上课安排独立保存地点。
- 插件不再向课程备注写入导入来源；备注完全留给用户记录实际事项。

真实强智课表页面验证结果：15 门课程、18 条上课安排、最大 16 周，节次范围为 1–12。

构建版本化包：

```powershell
./examples/plugin-qiangzhi/build.ps1 -OutputPath ./examples/plugin-qiangzhi/dist/qiangzhi-import-1.1.4.xhp
```
