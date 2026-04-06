module.exports = {
  apps: [
    {
      name: "discord-telegram-forwarder",
      script: "index.js",
      cwd: __dirname,
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PM2_HOME: `${__dirname}\\.pm2`,
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
