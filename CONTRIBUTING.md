# 插件投稿与更新说明

感谢你为星瀚课程表适配新的学校或教务系统。

## 提交目录

每个插件使用其 `plugin.json.id` 作为稳定目录名：

```text
plugins/<plugin-id>/
├─ plugin.json
├─ main.js
├─ icon.png       # 可选，最大 256 KiB
├─ theme.json     # 可选
├─ README.md
└─ CHANGELOG.md   # 推荐
```

可安装包放在：

```text
packages/<plugin-id>/<version>/<file-name>.xhp
```

`.xhp` 必须是 ZIP，且 `plugin.json`、`main.js`、可选的 `icon.png` 与 `theme.json` 必须直接位于 ZIP 根目录。

## 更新步骤

1. 修改插件源码，并在 `plugin.json` 中提高三段式版本号。
2. 更新 README 和 CHANGELOG。
3. 从当前源码重新生成 `.xhp`，不要复用旧 `dist`。
4. 将包放入对应版本目录。
5. 更新 `market/index.json` 的版本、下载地址、能力和 SHA-256。
6. 运行 `python scripts/validate_market.py`。
7. 通过 Pull Request 提交，说明测试的学校、页面和已验证流程。

## 安全要求

- 只声明实际使用的最小能力。
- 不得保存、上传或打印账号、密码、Cookie、Token、验证码结果及含凭据的 URL。
- 不得绕过验证码、双因素认证或学校安全策略。
- 不得动态下载并执行未随插件提交审查的远程脚本。
- 登录失效时应引导用户重新登录，不得反复提交或猜测一次性令牌。
- HTTP 地址必须在 README 中明确提示仅用于可信校园网络或可信 VPN。
- 不得以备注字段写入“由某插件导入”等无关内容。

所有新插件和敏感更新均需人工审查后合并。
