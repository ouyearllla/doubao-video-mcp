# 发布

包名：`doubao-video-mcp`。版本见 `package.json`，许可证为 MIT。

## 检查与打包

在源码目录逐条执行，检查失败时先修复：

```powershell
npm test
npm run check
npm pack --dry-run
npm pack
```

核对文件清单，并在独立目录安装 `.tgz`，验证版本、配置和 MCP 握手。包内不得包含登录数据、个人路径、任务记录或视频。

## 上传

确认本次发布已获维护者授权，核对账号和版本后执行：

```powershell
npm login --auth-type=web --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
```

在 npm 页面完成身份验证；不要将密码或 Token 写入项目。每次发布使用新版本号。

npm 提示处理完成后，查询公开版本并验证实际安装。上传被接受不等于已经可下载；处理中不要重复发布。

升级用户还需运行 setup 并重连 MCP，见 README。包版本与本地桥接协议版本独立；协议未变时保留兼容版本。
