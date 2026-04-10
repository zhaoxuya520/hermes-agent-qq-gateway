module.exports = {
  apps: [
    {
      name: "hermes-qq-gateway",
      script: "dist/index.js",
      cwd: ".",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
