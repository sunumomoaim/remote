// インストール可能にするための最小の Service Worker。キャッシュはしない（判定結果は常に最新を取りに行く）。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
