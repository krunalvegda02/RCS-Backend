module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: 6379,
        MONGODB_URI: process.env.MONGODB_URI
      },
      wait_ready: true,
      listen_timeout: 10000
    },
    {
      name: 'worker',
      script: 'src/workers/worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: 6379,
        MONGODB_URI: process.env.MONGODB_URI
      },
      wait_ready: true,
      listen_timeout: 10000,
      restart_delay: 5000
    }
  ]
};