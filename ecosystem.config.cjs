// pm2 用の設定。`npm run daemon` で常駐、`npm run daemon:logs` でログ。
// .env の値は pm2 起動前に `set -a; source .env; set +a` で読み込むか、下の env に直接書く。
module.exports = {
  apps: [
    {
      name: "reply-driver",
      script: "dist/index.js",
      cwd: __dirname,
      // 落ちたら自動で再起動（起動失敗の連打は 10 秒間隔で抑える）
      autorestart: true,
      restart_delay: 10000,
      max_restarts: 50,
      // ログ
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
        // ここに書いてもよい（.env を使う場合は不要）
        // SLACK_BOT_TOKEN: "xoxb-...",
        // SLACK_APP_TOKEN: "xapp-...",
        // PROJECT_ALLOWED_TOOLS: "Bash(npm *) Bash(git *) Bash(ls*)",
      },
    },
  ],
};
