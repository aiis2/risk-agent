# Desktop 构建资源

本目录存放 `electron-builder` 所需的签名与打包资源。

## 必备图标

运行打包前请准备以下文件（MVP 可暂用占位图）：

- `icon.ico` — Windows NSIS 安装包 (256x256, 多尺寸)
- `icon.icns` — macOS dmg / zip
- `icon.png` — Linux AppImage / deb (512x512)

CI 环境中可通过 `resources/*.png` + `electron-icon-builder` 自动生成。

## 签名凭据（通过环境变量注入，不入库）

| 平台 | 变量 | 说明 |
|---|---|---|
| Windows | `CSC_LINK` / `CSC_KEY_PASSWORD` | Code-signing `.pfx` 的 base64 / 密码 |
| Windows (EV) | `WINDOWS_EV_CERT_THUMBPRINT` | 可选，使用硬件 Token 时 |
| macOS | `CSC_LINK` / `CSC_KEY_PASSWORD` | Apple Developer ID Application `.p12` |
| macOS 公证 | `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | 开启后 electron-builder 会走 notarytool |

CI workflow (`.github/workflows/release-desktop.yml`) 已经把这些变量映射为 GitHub Actions secrets。

## 本地签名速查

```powershell
# Windows —— 设置本地变量并打包
$env:CSC_LINK   = "D:\\secrets\\risk-agent.pfx"
$env:CSC_KEY_PASSWORD = "<pfx password>"
pnpm --filter @risk-agent/desktop build

# macOS
export CSC_LINK=~/secrets/risk-agent.p12
export CSC_KEY_PASSWORD=***
export APPLE_ID=dev@aiis2.local
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=AAAAAAAAAA
pnpm --filter @risk-agent/desktop build
```

当上述变量缺失时，electron-builder 会自动跳过签名、产出未签名的安装包（适用于内部冒烟）。
