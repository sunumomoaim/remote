const DEFAULT_SERVER = "http://localhost:3100";
const input = document.getElementById("server");
chrome.storage.sync.get({ server: DEFAULT_SERVER }).then((v) => (input.value = v.server));
document.getElementById("save").addEventListener("click", async () => {
  const server = input.value.trim().replace(/\/$/, "") || DEFAULT_SERVER;
  await chrome.storage.sync.set({ server });
  document.getElementById("msg").textContent = "保存しました";
});
