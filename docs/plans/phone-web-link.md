# 手機操控改為網頁（Alca Link）：規劃與交接

> 接手的 agent 先讀完本檔，再看第 9 節的進度，從第一個未完成的任務繼續。開發分支：`phone-web-link`。
> 回覆使用者一律用繁體中文。程式註解遵守根目錄 `AGENTS.md`（只寫程式碼無法表達的事，不提計畫或歷史）。

## 1. 目標

完全撤除手機原生 App 對電腦的連線方式，改成手機瀏覽器或加到主畫面的網頁（PWA）。手機能做到桌面版的全部功能，介面為手機重新設計。專案開源：任何人都能用官方公開中繼，也能自架中繼和網站。

## 2. 使用者已做的決定（不要重新討論）

| 項目 | 決定 |
|---|---|
| 舊連線 | 完全撤除，不並存。沒有使用者，不做遷移 |
| 使用對象 | 開源給所有人；官方公開中繼加上可自架中繼 |
| 雲端主機 | 要支援。保留 `serve --tailscale` 和自架 HTTPS proxy 的瀏覽器入口，只供電腦管理主機 |
| 刪除的遠端入口 | `serve --tunnel`、Team 手機配對 |
| 手機功能範圍 | 全功能（桌面版能做的手機都要能做） |
| 介面策略 | 共用核心（狀態、API 邏輯），手機外殼重做；設定等深層頁面先沿用再逐批調整 |
| UI/UX 參考 | Hark Pro、Meta Muse、Grok Bot 的版面和互動概念；不抄外觀、品牌或文字 |
| 直連參考 | `~/alca-agent` 的 `p15` 分支（`packages/link`、`services/rendezvous`、`services/relay-worker`、`apps/phone-pwa`）。`~/Downloads/claude code/alca-agent` 是較舊的 `mac-test-2`，不要用 |
| 流程 | 使用者授權：照本檔依序做，不必每步詢問 |

### 由 agent 依使用者授權決定的預設

- **公開中繼不用登入。** 電腦以金鑰證明信箱，手機靠配對。移除 alca-agent 的 Google 帳號目錄與 webhook 信箱。
- **公開中繼只接受官方網站的 Origin。** 自己放網站的人搭配自己的中繼（`ALLOWED_ORIGINS`）。
- **直連預設開啟。** 內建公開 STUN（Cloudflare、Google），可改可關，文件和設定頁寫明 STUN 業者會看到公網 IP。不用 TURN，中繼就是備援。
- **配對時選權限：** 「完整」＝ `admin` + `client`；「僅日常操作」＝ `client`。
- **遠端連線預設關閉。** 由電腦擁有者開啟，開啟後才向外連中繼。

### 必須先問使用者才能做（授權不涵蓋）

1. `git push`：`alca-bots` 是公開 repo，推上去會公開原本私有的 `alca-agent` 程式碼。
2. 部署或改動線上服務：Cloudflare Worker、DNS、網站、已上線的 `alcabots-control-plane`。
3. 付費升級、發 release。

## 3. 現況（改動前）

```text
手機 App ──▶ companion :8810 ──loopback──▶ harness 127.0.0.1:8799
             配對、token、allowlist、scrub
```

- `companion/`：sidecar，拒絕任何帶 `Origin` 的請求，瀏覽器連不上。
- 路線：LAN／Tailscale（Noise + yamux，`companion/src/e2e/`）、Cloudflare tunnel（`electron/managed-companion-*`、`server/tunnel.ts`）、`relay/`（未部署）。
- 另有瀏覽器路線：harness 提供桌面版 UI，cookie session（`server/sessions.ts`、`/api/auth/pair`）。保留給電腦管理主機。
- repo 內沒有手機 App 原始碼；`apps/` 只有文件站。

前端可重用的基礎：176 個檔案經 `src/state/api.ts` 的 `api()`，22 個直接 `fetch`，SSE 集中在 `src/lib/live-events.ts`，148 個檔案以 `window.abot?.` 使用桌面專屬能力，瀏覽器裡為 undefined。前端不含測試約 12.9 萬行。

## 4. 目標架構

```text
手機網站（bots-app.alca-corp.me 或自架）
  src/phone/：配對、外殼
  link fetch/EventSource/WebSocket 墊片：同源 /api/* 改走 Link
        │  WebRTC data channel（優先）
        │  中繼 WebSocket（備援，只有密文）
        ▼
電腦或雲端主機的 harness 行程
  server/link/：LinkHost、裝置名冊、HTTP bridge
        │  loopback HTTP + Bearer alca_sess_…
        ▼
  harness 現有 HTTP API（request-auth 依 session scopes 判斷）
```

### 4.1 程式碼配置

| 路徑 | 內容 | 來源 |
|---|---|---|
| `link/src/` | 協定：SPAKE2 配對、簽章 session、sealed frame、RPC、WebRTC、client、host | `packages/link/src`，移除 enroll／account／host-hooks |
| `link/relay/` | `RelayHub` 與 Node 中繼（可 `--pwa` 一併提供網站） | `services/rendezvous`，移除 Google 與 hooks |
| `link/relay-worker/` | Cloudflare Worker + Durable Object | `services/relay-worker`，移除 Google 與 hooks |
| `link/test/` | 協定和中繼測試 | 同上 |
| `server/link/` | harness 端：host 生命週期、裝置儲存、HTTP bridge、routes | 新寫 |
| `src/phone/` | 手機入口、配對畫面、Link 墊片、外殼 | 新寫，參考 `apps/phone-pwa/app/{pairing,keystore,reconnect}.ts` |
| `phone.html` | 手機網站入口（vite 第三個 input） | 新寫 |

依賴：`@noble/curves@2.3.0`、`@noble/hashes@2.3.0`、`werift@0.26.0`（`optionalDependencies`，要併入 `scripts/bundle-server.mjs` 和打包流程）。一律用相對路徑 import（repo 以 `node --experimental-strip-types` 執行）。

授權：兩專案都是 Apache-2.0。移植檔案不必逐檔加標頭，`NOTICE` 記一筆來源。

### 4.2 認證：Link 裝置對應 harness session

不新增第二條認證路徑。配對成功時，host 用 `sessions.issue({label, scopes})` 取得 `alca_sess_…`，存進裝置名冊。bridge 轉發時帶 `Authorization: Bearer`，`resolveRequestAuth` 照常處理。

- 手機永遠看不到 session token，token 只留在電腦。
- token 過期或失效時，bridge 用已驗證的裝置金鑰重新簽發同 scopes 的 session。
- 撤銷裝置：`sessions.revoke`、`LinkHost.disconnect`、名冊標記 revoked，三者都做。
- 名冊與金鑰存 `<DATA_DIR>/link/`，檔案權限 0600。

**安全不變量**

- bridge 只轉發白名單方法、`/api/` 與 `/.well-known/alcabots/` 路徑，拒絕 `/api/internal/`、`..`、反斜線、控制字元。
- 請求標頭用白名單：`content-type`、`accept`、`accept-language`、`range`、`if-none-match`、`if-modified-since`、`last-event-id`、背景請求標頭。裝置送來的 `authorization`、`cookie`、`host`、`origin`、`x-forwarded-*`、`x-alcabots-*` 一律丟棄。
- 回應標頭也用白名單，絕不回傳 `set-cookie`。
- 標頭只能由 bridge 設定 Bearer，且 bridge 不傳 loopback 專屬的內部 token，使請求不會被視為本機擁有者。

### 4.3 HTTP over Link（線路協定）

都跑在 sealed RPC 裡（`LinkPeer`）。單一訊息上限受 Worker 1 MiB 限制，所以 body chunk 上限 128 KiB（base64url 後傳）。

裝置 → host（request，等回覆即是上傳的背壓）：

| op | args | 回覆 |
|---|---|---|
| `http.open` | `{id, method, path, headers, body?: boolean}` | `{}` 或錯誤 |
| `http.body` | `{id, d: b64u, end: boolean}` | `{}` |
| `http.ack` | `{id, bytes}` | `{}`（下載視窗） |
| `http.cancel` | `{id}` | `{}` |

host → 裝置（事件，頻道 `http`）：

```text
{id, t:"head", status, headers}
{id, t:"data", d}        // 每條串流未確認資料上限 1 MiB，靠 http.ack 補額度
{id, t:"end"}
{id, t:"error", message}
```

`ws.open` / `ws.send` / `ws.close` 與事件頻道 `ws`（`open`、`message`、`close`）比照辦理，供 noVNC 和語音通道用，放在第三階段。

限制：每裝置同時 64 條串流；session 關閉時取消該 session 全部串流；id 由裝置產生，重複即拒絕。

### 4.4 手機端墊片

- `installLinkFetch()`：包住 `globalThis.fetch`，同源且路徑符合 4.2 的才走 Link，其他走原生。回傳真的 `Response`（body 為 `ReadableStream`），`AbortSignal` 對應 `http.cancel`。
- `LinkEventSource`：取代 `globalThis.EventSource`，用同一條 fetch 解析 SSE，自動重連帶 `Last-Event-ID`。
- 媒體標籤（`<img src="/api/…">`、`<audio>`、下載）：service worker 攔截同源 `/api/*`，用 `MessageChannel` 請頁面代為走 Link 後回應。放在第二階段。
- 除配對資料外不動既有呼叫點，共用核心因此不必改。

### 4.5 連線策略

沿用 `LinkClient`：先中繼，已驗證的 session 裡發 `rtc.offer`，通道開啟後重新做簽章握手並再次封裝。失敗退回中繼。補上筆記專案的經驗：回前景時立即檢查連線、直連剛切換就斷時留在中繼 5 分鐘。

### 4.6 配對流程

1. 桌面「設定 → 手機」按「連接手機」，選權限，顯示配對碼與 QR：`<網站>/#pair=<digits>&fp=<指紋>&pk=2&r=<中繼>`。
2. iPhone 主畫面 App 和 Safari 儲存分離，所以網站第一頁在 Safari 引導「加到主畫面」，再從主畫面 App 輸入配對碼（或掃 QR）。Android 和已安裝 PWA 可直接開連結。
3. 雙方互相釘選金鑰。手機金鑰是 IndexedDB 裡不可匯出的 P-256。
4. 配對連結放 `#` 後面，不會送到網站主機。

### 4.7 新增信任風險（已知，文件要寫清楚）

- 能改手機網站部署的人就能操作手機端權限。自架者要能連網站一起自架。
- 中繼看得到中繼資料（哪個裝置連哪個信箱、時間、流量），看不到內容。
- 「完整」權限手機等於桌面權限。第三階段對不可復原操作加二次確認。
- 公開中繼由使用者付費；單一 Durable Object 上限 5000 連線，公開上線前要評估分割。

## 5. 舊連線撤除清單（第一階段最後一步）

**刪除**

- `companion/`、`relay/`（舊）、`tsconfig.companion.build.json`、`scripts/mark-module-scope` 的 companion 用途、`build:companion`、`companion` script
- `electron/`：`companion*.mjs`、`managed-companion-*`、`desktop-companion-client.mjs`、`phone-secret-identity.mjs`、`e2e-identity.mjs`、相關 `.d.mts` 和測試，以及 `main.mjs`、`preload.cjs`、`bridge-contract.json` 的銜接
- `server/`：`tunnel.ts`、`harness/tunnel-gzip.ts`、`cli-phone-setup.ts`、`phones/`、`host/phones.ts`、`routes/phones.ts`、`routes/team-phone.ts`、`phone-secret.ts`、`drivers/` 裡 `PHONE_*` 的 device MCP，以及 `/api/pair`、`x-alcabots-companion*` 認證分支
- `src/`：`PhoneAppDialog`、`PhoneSetupFlow`、`PhonesList`、`PairedPhones`、`TeamPhoneCard`、`bot-settings/PhoneAppsCard`、`companion-*` lib、`phone-relay-preview`（含根目錄 html）
- `shared/`：`phone-apps.ts`；`pairing-link.ts` 改寫成新連結格式
- `cloudflare/control-plane`：`relay.ts`、`push.ts`、tunnel 相關的程式。線上 Worker 不動，等使用者同意才部署
- 文件：`docs/ios-companion.md`、`docs/desktop-companion.md`、`docs/cloud-pro.md` 內相關段落、`docs/self-hosting.md` tunnel 段落
- 依賴與打包：`cloudflared` 下載（`scripts/prepare-cloudflared.mjs`）、`@hpke/*`、electron-builder 的 companion 項目

**保留**

- `skills/phone-harness` 與 `server/drivers/phone-proxy.ts`：USB/ADB 操作 Android，和連線無關。
- `serve --tailscale`、自架 proxy、`/api/auth/pair`、`src/pair/PairPage.tsx`：電腦瀏覽器管理主機。
- `public/manifest.webmanifest`（改為手機網站使用）。

**重要：** 下刪除手前，先 `git grep` 每個符號的使用者。`routes.ts` 的 `denyReason` 被 `server/request-auth.ts` 匯入；`companionDevice` 欄位散布在 server 路由。依賴它的權限判斷要改成 session scopes，不可以直接放寬。

## 6. 四個階段

### 第一階段：連線

| # | 任務 | 驗收 |
|---|---|---|
| 1.1 | 移植 `link/src` 與測試，加入依賴 | `pnpm exec vitest run link/` 全綠 |
| 1.2 | 移植中繼 Node 版與 Worker 版，移除 Google 和 hooks | 中繼測試全綠；設定錯誤時 `/healthz` 回報 |
| 1.3 | `server/link/`：host 生命週期、名冊、配對、撤銷 | 單元測試：配對、撤銷、重啟後名冊仍在 |
| 1.4 | `server/link/bridge`：HTTP over Link | 對真 harness 的測試：標頭白名單、SSE、body 串流、取消、Bearer scopes |
| 1.5 | harness routes 與設定：`/api/link/*`、`linkRelayUrl`、`linkPwaUrl`、`linkIceServers`、`linkEnabled` | 路由測試；只有 admin 可呼叫 |
| 1.6 | 手機端：`phone.html`、`src/phone/` 墊片、配對畫面、掛上現有 `<App/>` | 無頭瀏覽器 e2e：自架中繼 + fixture harness，配對後送訊息並收到回覆 |
| 1.7 | 桌面端「連接手機」新 UI，取代 `CompanionSection` | UI 測試；i18n 檢查通過 |
| 1.8 | 撤除舊連線（第 5 節） | `pnpm typecheck`、`pnpm lint`、`pnpm i18n:check`；受影響測試通過；`git grep` 無殘留 |
| 1.9 | 真機檢查表交給使用者（第 8 節） | 文件完成；真機結果由使用者回報 |

### 第二階段：手機主要體驗

資訊架構（概念取自參考產品，視覺自行設計，沿用 AlcaBots 的 design tokens）：

- **今天：** 首頁。上方是「等你決定」的卡片堆（核准、問題、登入要求），下面是進行中的工作和有新進度的 bot。沒事時不打擾。（Hark 的層疊卡片、Muse 的「需要你才回來」）
- **夥伴：** 有頭像、名字和狀態的 bot 名冊，群組也在這裡。（Grok Bot 的同事名冊）
- **對話：** 為手機重做的聊天頁：輸入框、語音文字、附件、串流回覆、工具列折疊。
- **工作：** routines、背景任務、專案。
- **電腦視窗：** 從對話或 bot 打開，全螢幕看 bot 的瀏覽器或電腦，可接手。（Grok Bot 的電腦視窗）
- 核准一律用底部抽屜。頂部顯示連線狀態（直連、中繼、離線）。

| # | 任務 |
|---|---|
| 2.1 | 外殼與導覽：分頁、深色淺色、安全區、鍵盤處理 |
| 2.2 | 今天頁：由現有 store 導出待決定與進行中 |
| 2.3 | 夥伴頁 |
| 2.4 | 對話頁：重用訊息渲染元件，重做版面與輸入框 |
| 2.5 | 核准抽屜：核准、問題、secret／sign-in 卡片 |
| 2.6 | 電腦視窗：ego lite live view 與接手 |
| 2.7 | service worker：媒體代理、離線外殼、更新流程 |
| 2.8 | Web Push：電腦端 VAPID，透過瀏覽器推播服務，iOS 需先加到主畫面 |
| 2.9 | 離線快取：參考 `apps/phone-pwa/app/cache-*.ts` |

驗收：390 寬無頭瀏覽器截圖檢查、e2e 流程、沒有水平捲動、觸控目標至少 44px。

### 第三階段：其餘功能補齊

把桌面版功能列成對照表（`docs/plans/phone-web-parity.md`）逐項標記，再分批處理：

1. 新增與設定 bot、模型、技能、profile
2. Routines、團隊記憶、群組、搜尋
3. 連接 App、MCP
4. 設定：engines、API key（走已封裝的通道）、外觀、語言
5. 電腦：VM、VPS、noVNC（`ws.*` 通道），以及語音通話（`src/lib/live-call-media.ts`）
6. 檔案上傳下載、匯出、備份
7. 桌面專屬項目明確標示「請在電腦上做」：開資料夾選擇器、應用程式更新、視窗控制
8. 不可復原操作的二次確認（刪除 bot、撤銷、清資料）

### 第四階段：公開上線（需要使用者同意才動線上）

| # | 任務 |
|---|---|
| 4.1 | 成本估算與 Durable Object 分割評估 |
| 4.2 | 部署 `bots-relay.alca-corp.me`、`bots-app.alca-corp.me`，CSP、`ALLOWED_ORIGINS`、`RELAY_MODE=production` |
| 4.3 | 自架文件：Node 中繼、Worker、Docker、自架網站 |
| 4.4 | README、`SECURITY.md`、`.oss-scanner/threat_model.md` 更新 |
| 4.5 | 清理 control-plane 並部署 |
| 4.6 | 發 release |

## 7. 工作規則

- 驗證 server 或對話改動時遵守 `docs/verification/README.md`：用隔離 fixture，絕不碰使用者的 `~/.alcabots`。
- 完整 vitest 本機超過一小時，只跑相關檔案；整套交給 CI（push 要先問使用者）。
- 改英文字串後跑 `node scripts/generate-locale.mjs --check`。
- 本機語系是中文，有 3 個時間格式測試只在 `LANG=en_US` 下才會過。
- 每完成一個任務就 commit，並更新第 9 節。commit 結尾加 `Co-Authored-By`。
- `git grep -E` 在這台機器不支援 `\b`，用 `-P` 或別的寫法，免得算出假的 0。

## 8. 真機檢查表（只有使用者能做）

需要先自架或部署中繼和網站。

- [ ] iPhone Safari 加到主畫面，主畫面 App 內配對成功
- [ ] 重開 App 後金鑰仍在，不必重新配對
- [ ] 同 Wi-Fi：狀態顯示直連
- [ ] iPhone 行動網路、電腦在家用路由器後：記錄是直連還是退回中繼，兩種都要能聊天
- [ ] 切換 Wi-Fi 和行動網路、鎖屏後回來：自動重連
- [ ] 撤銷手機後立刻無法操作
- [ ] Android Chrome 重複以上
- [ ] 推播（第二階段）：App 關閉時收到通知

## 9. 進度

更新時只改這裡。

- [x] 1.1 移植協定
- [x] 1.2 移植中繼
- [x] 1.3 host 生命週期
- [x] 1.4 HTTP bridge
- [x] 1.5 routes 與設定
- [x] 1.6 手機端
- [x] 1.7 桌面端 UI
- [x] 1.8 撤除舊連線
- [ ] 1.9 真機檢查表
- [ ] 第二階段
- [ ] 第三階段
- [ ] 第四階段

### 交接筆記

- 無螢幕主機：`alcabots phone [--daily]`（`server/cli-phone.ts`）開啟手機存取並印 QR 碼。
- `LinkClient.moveGraceMs`：手機用 30 秒，讓中繼換直連時舊連線上的請求能走完。
- 端對端驗證：`pnpm build:phone && PLAYWRIGHT_CORE=<playwright-core 路徑> SMOKE_SHOTS=<截圖目錄> node scripts/smoke-phone-link.mjs [--direct]`。
- 組織政策 `remoteAccess` 關閉時：擋 `POST /api/link/pairings`，也擋已配對手機的每個請求（bridge 的 `remoteAccessRefusal`）。
- 使用者文件：`docs/phone-link.md`。
- 線上服務（使用者已同意部署）：中繼 `https://bots-relay.alca-corp.me`（Worker `alcabots-relay`，`link/relay-worker`，部署時帶 `--var ALLOWED_ORIGINS:https://bots-app.alca-corp.me --var RELAY_MODE:production`）；手機頁 `https://bots-app.alca-corp.me`（Worker `alcabots-phone`，`link/site-worker`，建置時帶 `VITE_LINK_RELAY_URL=https://bots-relay.alca-corp.me`）。
- 對線上跑端對端：加 `SMOKE_LIVE_RELAY`、`SMOKE_LIVE_SITE` 給 `scripts/smoke-phone-link.mjs`。新子網域在開通前查過的話，路由器會快取「查無此網域」最多 30 分鐘。
- 全套測試還剩 4 個在這項工作之前就失敗的項目，都不是手機連線造成的：`server/saved-steps/store.test.ts`（refuses a bot id…）、`src/lib/schedule-label.test.ts`、`src/lib/transcript-derivations.test.ts`、`src/components/SidebarThreadRow.test.ts`（後三個是機器語系為中文、測試預期英文）。`server/outbound-hold.test.ts` 高負載時偶爾在清暫存目錄失敗（ENOTEMPTY），單獨跑會過。
- 全套測試要用 `ALCA_VITEST_WORKERS=6 pnpm exec vitest run --reporter=dot`，預設一次只跑一個檔案，要跑很久。

**1.8 刻意留下、之後再清（都無害，但都是死碼或多餘資產）：**

- 前端 `window.abot?.remoteClient`：本機頁面的 preload 一律提供 `{ active: false }`，別台機器的頁面沒有這個物件。`localDesktopPage()` 靠它判斷「這是本機頁面」，所以**不能移除**。`active` 不會再是 true，散在 `src/` 的 `remoteClient?.active` 分支是死碼，可逐處刪除，但要保留本機判斷。
- 安裝包仍帶 `cloudflared`（`electron-builder.yml`、`scripts/after-pack.mjs`、`scripts/verify-linux-package.mjs`、release 工作流程）。Docker 映像的雲端主機 tunnel 還在用同一份 pin（`scripts/prepare-cloudflared.mjs`）。要實際打包驗證才能拆。
- `deviceMcp` / `integrations.device` / `DEVICE_PROXY_TIMEOUT_MS`：舊手機裝置工具的管線，已無來源。
- `cloudflare/control-plane` 的 managed endpoint（`endpoints.ts`、`tunnel-*.ts`）：relay 與 push 已刪，但這段留著，因為線上若有舊 endpoint 需要排程回收。刪之前要先確認線上狀態並問使用者。`0012_relay.sql`、push 資料表也留著，改 schema 要部署。
- `scripts/gen-app-fixtures.ts`、`gen-mascot-bodies.ts`、`gen-halloween-bodies.ts` 還會寫 `ios/`、Android 路徑，這個 repo 沒有這些目錄。
- `.oss-scanner/threat_model.md` 與 `docs/verification/*`、`docs/design/*` 仍提到 companion，第四階段更新 threat model 時一起處理。

- 設定不放 config，改放 `<DATA_DIR>/link/settings.json`，同目錄有 `identity.json`、`devices.json`（權限 0600，含手機的 session token）。
- `SessionRegistry.onSessionRevoked` 的 listener 多了第二個參數 `why`：過期只重發 session，被撤銷才視同移除手機。
- 中繼路徑的原始資料速率定為 400 KiB/s（`HTTP_RELAY_BYTES_PER_SECOND`），上傳端也要照這個值限速。
- `git grep -E '\\b…'` 在這台機器會誤回 0 筆，別用 `\\b`。
