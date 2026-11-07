# alca-bots 改名後待辦

本 repo 從 [OpenMausBot](https://github.com/milind-soni/OpenMausBot) v0.1.146（commit `90102ee90`）衍生而來，依 Apache-2.0 改名為 alca-bots。
程式與文件裡的名稱已全面替換，下列項目無法單靠改字完成，需要擁有者處理。

## 已完成

- 授權：`LICENSE` 原封不動；`NOTICE` 保留上游全文並在最前面加上衍生聲明；`LICENSING.md` 改寫為衍生作品說明。
- 刪除 upstream 非 Apache 授權的 `enterprise/`、只用於 enterprise 的 `CLA.md` 和 CLA workflow，另外刪了贊助設定（`FUNDING.yml`、`.well-known/funding-manifest-urls`）。
- 名稱替換（`third_party/`、`LICENSE`、`NOTICE` 不動）：
  | 舊 | 新 |
  |---|---|
  | `OpenMausBot` / `openmausbot` / `OPENMAUSBOT` | `AlcaBots` / `alcabots` / `ALCABOTS` |
  | `MausBot` / `mausbot` | `AlcaBot` / `alcabot` |
  | 吉祥物 `Maus` / `maus` | `Alca` / `alca` |
  | 內部前綴 `omb` / `OMB_*` / `X-Omb-*` | `alca` / `ALCA_*` / `X-Alca-*` |
  | 舊名前綴 `ogb`（MCP 工具 `mcp__ogb__*`） | `abot`（`mcp__abot__*`） |
  | `milind-soni/OpenMausBot(-releases)` | `ihsieh31/alca-bots` |
- 資料目錄因此變成 `~/.alcabots`，app id 變成 `com.alcabots.app`，npm 套件名稱改為 `alca-bots`，CLI 指令改為 `alcabots`。
- README、SECURITY、CODE_OF_CONDUCT、CONTRIBUTING 都已換掉上游作者的聯絡方式和贊助內容。

## 待處理

1. **驗證建置**：`pnpm install && pnpm typecheck && pnpm lint && pnpm test`。改名腳本是機械式替換，測試快照或 golden 檔可能需要更新。
2. **吉祥物與圖示（商標）**：`build/icon*`、`public/app-icon.svg`、`src/assets/`、`docs/screenshots/`、`docs/verification/evidence/` 裡還是上游的吉祥物和介面截圖，需要換成自己的美術。
3. **網域（目前指向不存在或不屬於你的主機）**：程式裡的 `*.alcabots.com`（cloud、accounts、device、relay1–3、admin、docs、www）和 `*.alcabot.si` 原本都是上游的雲端服務。你沒有這些網域，就要改成自己的網域，或關閉雲端／手機中繼功能。
4. **上游雲端服務**：`cloudflare/control-plane`、`cloudflare/composio-broker`、`relay/`、`connector/` 原本部署在上游帳號上（例如 `*.milindsoni201.workers.dev`）。要用的話得部署到自己的 Cloudflare 帳號並更新設定。boat.dev 的雲端電腦需要你自己的帳號。
5. **發佈與自動更新**：`electron-builder.yml` 已指向 `ihsieh31/alca-bots` 的 GitHub Releases。macOS 簽章與公證、Windows 簽章需要你自己的憑證；`.github/workflows/` 的 release、npm、docker 流程需要你自己的 secrets（npm token、`ghcr.io/ihsieh31`）。
6. **npm 套件名稱**：發佈前先確認 npm 上的 `alca-bots` 名稱可用。
