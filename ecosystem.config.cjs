module.exports = {
  apps: [
    {
      name: "discord-telegram-forwarder",
      script: "index.js",
      cwd: __dirname,
      interpreter: "node",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
