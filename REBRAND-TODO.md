# alca-bots 交接與待辦

本 repo 從 [OpenMausBot](https://github.com/milind-soni/OpenMausBot) v0.1.146（commit `90102ee90`）衍生而來，依 Apache-2.0 改名為 alca-bots。

## 開始開發

```sh
cd ~/Downloads/"claude code"/alca-bots
pnpm install            # pnpm 10 會略過套件的 build scripts；Electron 需要時執行 pnpm approve-builds
pnpm dev:server         # harness，在 127.0.0.1
pnpm dev                # 前端（Vite）
pnpm dev:desktop        # Electron 桌面版
pnpm typecheck && pnpm lint && pnpm i18n:check
pnpm exec vitest run <檔案>   # 完整套件很慢（本機一小時以上），整套交給 GitHub CI 分 shard 跑
```

改 server 或對話相關的東西時，照 `AGENTS.md` 的規則用 `docs/verification/README.md` 開一個隔離的 fixture 來驗證。

## 已完成

- **授權**：`LICENSE` 原封不動；`NOTICE` 保留上游全文並在最前面加上衍生聲明；`LICENSING.md` 改寫為衍生作品說明。
- **移除**：upstream 的 `enterprise/`（不是 Apache 授權）、CLA 和贊助設定。只測 enterprise 的測試在沒有該資料夾時會自動排除（`vite.config.ts`）。
- **改名對照**（`third_party/`、`LICENSE`、`NOTICE` 不動）：
  | 舊 | 新 |
  |---|---|
  | `OpenMausBot` / `openmausbot` / `OPENMAUSBOT` | `AlcaBots` / `alcabots` / `ALCABOTS` |
  | `MausBot` / `mausbot` | `AlcaBot` / `alcabot` |
  | 吉祥物 `Maus` / `maus` | `Alca` / `alca` |
  | 內部前綴 `omb` / `OMB_*` / `X-Omb-*` | `alca` / `ALCA_*` / `X-Alca-*` |
  | 舊名前綴 `ogb`（MCP 工具 `mcp__ogb__*`） | `abot`（`mcp__abot__*`） |
  | `milind-soni/OpenMausBot` | `ihsieh31/alca-bots` |
  - 結果：資料目錄為 `~/.alcabots`，app id 為 `com.alcabots.app`，npm 套件名稱為 `alca-bots`，CLI 指令為 `alcabots`。
- **網域**（`alca-corp.me`，Cloudflare 帳號 `c8670c9c…`）：
  | 用途 | 主機 | 狀態 |
  |---|---|---|
  | 雲端帳號與 tunnel 管理（control plane） | `bots-accounts.alca-corp.me` | **已部署**，`/healthz` 回 ok |
  | 每台電腦的 tunnel | `c-<32 hex>.alca-corp.me` | 由 control plane 自動建立 |
  | 手機中繼 relay | `bots-relay1/2.alca-corp.me` | 未部署（需要 VPS），已在設定中關閉 |
  | 雲端主機、後台、文件站 | `bots-cloud` / `bots-admin` / `bots-docs` / `bots-device` / `bots.alca-corp.me` | 未部署 |
  - 已移除 upstream 的第二網域 `alcabot.si`：它不屬於你，保留會讓別人有機會冒充你的主機。
  - Cloudflare 端已建好：D1 資料庫 `alcabots-control-plane`（migrations 已套用）、Worker secrets `CLOUDFLARE_API_TOKEN`、`BETTER_AUTH_SECRET`、API token `alca-bots-control-plane`（帳號的 Tunnel Edit 加上 alca-corp.me 的 DNS Edit）。
- **macOS 簽章**：ad-hoc 簽章（`identity: "-"`），不做公證。release workflow 已移除 Developer ID 憑證、公證和舊版鏡像的步驟，改用 `GITHUB_TOKEN`。
- **測試與 CI**：
  - 改名造成的測試失敗都已修好：簽章和雜湊的固定值、排序（`abot`、`ALCA_*` 現在排在最前面）、長度（`alca_pair_` 比舊前綴多 1 字元），以及用 Swift CryptoKit 重新產生的 HPKE 測試資料（`server/phone-secret.test.ts`）。
  - 已拿掉 `~/.openmausbot → ~/.alcabots` 的舊資料夾搬移，以及它的測試：改名後這段只會把 `~/.alcabots` 搬到它自己，沒有意義。
  - CI 的 Linux vitest shard 會先刪掉 `/usr/bin/bwrap`。上游的測試假設 GitHub runner 上沒有 bubblewrap，但現在的 ubuntu image 可以執行 bwrap，會讓 cloud-team 和 box 的測試失敗。我在 podman 裡確認過，上游原版程式碼也是同樣的失敗，不是改名造成的。
  - `scripts/testing/ci-retry-list.json` 新增了兩個只在 CI 偶發失敗的電腦等待測試（owner 為 ihsieh31）。之後修好這兩個測試，再把它們從清單移除。

## 待處理

1. **吉祥物、圖示、截圖（商標）**：`build/icon*`、`public/app-icon.svg`、`src/assets/`、`docs/screenshots/`、`docs/verification/evidence/` 裡還是上游的美術，需要換掉。
2. **Email 登入驗證碼**：Cloudflare Email Sending 需要 Workers Paid（每月 5 美元）。升級後到 alca-corp.me → Email → Email Sending 完成網域設定，寄件地址是 `noreply@alca-corp.me`。在那之前，雲端帳號的 email 登入寄不出信；本機使用 App 不受影響。
3. **Composio broker**（連接 500+ App 的功能）：App 預設的 broker 網址已經改成 `https://bots-composio.alca-corp.me`（`electron/managed-composio.mjs`），但還沒部署，所以目前「連接 App」功能無法使用。`cloudflare/composio-broker/wrangler.jsonc` 裡的帳號和 route 都已經設好，只剩 D1 和 API key 要你處理。準備好 Composio API key 之後：
   ```sh
   cd cloudflare/composio-broker
   # 把 wrangler.jsonc 的 database_id 換成 `npx wrangler d1 create alcabots-composio` 回傳的值
   npx wrangler d1 migrations apply alcabots-composio --remote
   npx wrangler secret put COMPOSIO_API_KEY
   npx wrangler deploy
   ```
4. **手機中繼 relay**：需要一台 VPS 跑 `relay/`（有 Dockerfile 和 Caddyfile），DNS 指到 `bots-relay1.alca-corp.me`；之後在 control-plane 的 `wrangler.jsonc` 設 `RELAY_NODES`、`RELAY_DISABLED: "0"` 和 `RELAY_TOKEN_SIGNING_KEY`。
5. **瀏覽器換成 ego lite**：分支 `ego-lite-browser` 兩個階段都已完成。bot 只透過 ego lite 瀏覽（`server/ego-browser.ts`、`server/ego-browser-proxy.ts`，設計見 `docs/plans/browser-engine.md`），舊的內置瀏覽器（agent-browser、alca-cdp、瀏覽器面板、瀏覽器設定檔、fill_login、My Chrome、打包的 Chromium 及其 CI）已刪除。分支 `workbuddy/ego-lite-cleanup` 接著清剩下的部分：

   **已清**
   - Docker 映像檔、CI 與 compose：`Dockerfile` 不再裝 Chrome 系統庫、agent-browser 或 Chrome for Testing；`docker.yml` 移除瀏覽器 smoke、Chrome/Chromium 版本快取鍵與 build-args；三個 compose 檔移除只為 Chrome 設的 `shm_size`；環境白名單不再帶 `AGENT_BROWSER_EXECUTABLE_PATH`。`scripts/docker-image.test.ts` 同步改斷言，並加了一條「映像裡不得出現瀏覽器二進位」的檢查。
   - 其他語系的舊瀏覽器字串：刪掉 114 個英文 key、共 1015 條翻譯與 901 筆 source hash。保留仍被 `feature-flags.ts`、`ComputerPanel.tsx` 使用的 `browser.noEngine`、`computer.browserSwitch.title`。
   - `browserMatesOf`／`loginHeldBackFor`，以及 `BotLogins` 裡只服務它們的 `bots`、`cardBots`、`sitesFor`、`markUsed`。
   - 設定裡的 `browserProfiles`、bot 的 `browserProfile`／`recordBrowserSteps`：已刪。舊的 `config.json`、`bots.json`、team 檔和套件檔留著這些欄位仍可載入，下次存檔時丟掉。
   - 借電腦的網路連線與 Chrome，以及整條 device link 通道（`server/device-links.ts`、`electron/device-link*.mjs`、`electron/device-egress.mjs`）：它們只服務雲端的內置瀏覽器，已一起下線。舊授權裡的 `internet`／`chrome` 欄位會被忽略；曾取消勾選網路連線的人仍視為「說過不要」，啟動時保持暫停。

   **保留（不是殘留）**
   - UI 驗證 harness `scripts/testing/control-alca-ui.ts` 仍用開發者自己裝的 agent-browser（`scripts/testing/agent-browser-cli.ts` 是上個 commit 刻意留下的）；它驅動的是被測的 renderer，跟 bot 用哪個瀏覽器無關。砍掉會連帶毀掉 CI 的 `ui-smoke` job、約 30 個 e2e 與 `docs/verification/chat-ui.md` 等 recipe；要換 driver 得先重寫 snapshot／ref／session 語意，屬獨立工程。
   - 已存的登入資料與 1Password（`server/login-store.ts`、`server/onepassword.ts`、`server/bot-logins.ts`、`/api/logins`、`@1password/sdk` 與它的打包步驟、雲端搬移時的登入資料、`onePasswordToken` 憑證卡）：已刪。`secretForms` 移到 `server/secret-forms.ts`；`login-handoff.ts` 只留連線搬移用的通道，`scripts/smoke-login-handoff.cjs` 改成透過真的 utility port 交接一把 API key。目前沒有使用者，舊資料不做遷移。
   - bot 的系統提示、工具說明與介面文字：不再提「built-in browser」或已不存在的 `browser_navigate` 等工具，改說 ego lite 與 `ego_browser_guide`／`ego_browser_run`；My Cloud 與 Linux 的提示不再說有瀏覽器。舊的 `agent_browser_*` 工具名別名、`save-login` 與 `/browser/stream|upload` 路由授權、`totp.ts`、`third_party/playwright-injected` 已刪。
   - 授權：`NOTICE`、`LICENSING.md` 註明 ego lite 是 Citro Labs 的專有軟體（不打包、不散布），bot 指引改寫自 MIT 授權的 ego-browser skill，授權文字在 `third_party/ego-lite/`。

   - 手機看／操控 bot 的瀏覽器改接 ego lite：手機 app 講的 v1 協定（`GET /api/bots/:id/browser/live` SSE、`POST …/browser/action`）由 `server/ego-live.ts` 提供，輪詢 bot 最新 task space 的作用中分頁截圖，接手後用 ego lite 的 Page API 點擊、打字、換頁。bot 用過的 space 與手機的「接手」存在資料夾的 `ego-browser/`（`server/ego-state.ts`），接手期間 bot 的 `ego_browser_run` 會被拒絕。手機配對的「允許瀏覽器控制」權限因此又有作用。尚未用真的手機測過。
   - 已清：ComputerPanel 的瀏覽器控制租約空殼、`alcabots:browser-control` 訊息；My Cloud 不再提供 Browser 這個 place。
6. **macOS 使用者**：App 第一次打開要「右鍵 → 打開」；自動更新在 macOS 上不會運作，要手動下載新版。
7. **發佈**：改 `package.json` 的 version 並推上 main 會觸發 Release workflow。npm 發佈（`alca-bots`）和 Docker（`ghcr.io/ihsieh31/...`）的 workflow 可能還需要調整 secrets。
