# ClassSchedule XHP 插件市场

星瀚课程表的官方 XHP 插件仓库与发布元数据仓库。这里保存插件源码、可安装的 `.xhp` 包、App 读取的市场索引，以及 APK 更新索引。

> 当前处于测试阶段。插件能够读取其打开网页的内容，请务必只安装自己信任的插件，不要在来源不明的插件中输入账号或密码。

## 已收录插件

| 插件 | 版本 | 维护方 | 下载 |
|---|---:|---|---|
| 强智教务课表导入 | 1.1.4 | Xialuo | [下载 XHP](packages/dev.xinghan.qiangzhi/1.1.4/qiangzhi-import-1.1.4.xhp) |
| 广财课表自动导入 | 2.0.2 | Xialuo | [下载 XHP](packages/dev.xinghan.gdufe/2.0.2/gdufe-course-import-2.0.2.xhp) |
| 广州华商学院课表导入（测试版） | 1.0.2 | Xialuo | [下载 XHP](packages/dev.xinghan.huashang/1.0.2/huashang-course-import-1.0.2.xhp) |

市场索引：[`market/index.json`](market/index.json)

App 更新索引：[`app/update.json`](app/update.json)

App 更新日志：[`app/CHANGELOG.md`](app/CHANGELOG.md)

## 仓库结构

```text
plugins/              插件源码，每个插件使用稳定 ID 作为目录名
packages/             按插件 ID 和版本保存的可安装 XHP 包
market/index.json     App 可读取的市场索引
app/update.json       App 版本、GitHub Release 地址与 APK SHA-256
schemas/              市场元数据规范
scripts/              本地与 CI 校验脚本
.github/workflows/    Pull Request 和推送自动检查
```

## 本地校验

需要 Python 3.10 或更高版本，无第三方依赖：

```bash
python scripts/validate_market.py
```

校验会确认插件 ID、版本、能力、最低 App 版本、官方 URL、包体大小、ZIP 根目录结构、包内源码和 SHA-256 与市场索引一致，并检查 App 更新元数据。

## 安全边界

- XHP 插件不是 Android 原生代码，不能直接访问星瀚课程表数据库、文件系统或修改 App 源码。
- 插件打开的网页能够访问宿主提供的 XHP Bridge，因此插件源码和目标网站都属于信任边界。
- HTTP 仅适用于可信校园内网；条件允许时应优先使用 HTTPS。
- App 已固定本仓库的 HTTPS 地址并校验 SHA-256 与 XHP 结构，但市场目录尚未加入独立数字签名；当前仍信任 GitHub TLS 和仓库控制权，后续可增加内置公钥与签名索引。
- 安装和更新插件前仍应由用户确认，不能静默替换插件。

投稿与版本更新请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请阅读 [SECURITY.md](SECURITY.md)。

## 许可证

本仓库尚未选择统一开源许可证。在添加 `LICENSE` 之前，请不要默认复制、再发布或用于其他项目；社区投稿规则会在许可证确定后进一步完善。
