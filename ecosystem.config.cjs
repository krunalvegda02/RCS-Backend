module.exports = {
  apps: [
    {
      name: 'api',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        MONGODB_URI: 'mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority',
        KAFKA_BROKER: 'localhost:9092',
        CLOUDINARY_CLOUD_NAME: 'doce6f5xn',
        CLOUDINARY_API_KEY: '646961174768865',
        CLOUDINARY_API_SECRET: 'obQQcEz0sHCyg4AbxzTn-DW1Trc',
        JWT_SECRET: 'Z9a8xM!2kP@7Lq1dFhR3CwdwdwdWnA5SeTQ',
        JWT_REFRESH_SECRET: 'Qp7FJc2Z01W5R!D6xB8dwdwLHTeKaM',
        JWT_EXPIRE: '1d',
        JWT_REFRESH_EXPIRE: '7d',
        PASSWORD_ENCRYPTION_KEY: 'Z9a8xM2kP7Lq1dFhR3CwdwdwdWnA5Se',
        BCRYPT_ROUNDS: '10',
        EMAIL_USER: 'info@rcssender.com',
        EMAIL_PASS: 'Large@sender123',
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '587',
        SMTP_USER: 'info@rcssender.com',
        SMTP_PASS: 'Large@sender123',
        SMTP_FROM: 'RCSsender <info@rcssender.com>',
        ADMIN_NOTIFICATION_EMAIL: 'info@rcssender.com',
        DEMO_USER_ID: '695bb14daa33b8b6f21303e6',
        CORS_ORIGIN: 'https://www.rcssender.com/',
        FRONTEND_URL: 'https://rcssender.com/',
        REDIS_URL: 'redis://127.0.0.1:6379',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '6379',
        JIO_ENV: 'production',
        JIOAPI_BASE_URL: 'https://api.businessmessaging.jio.com',
        JIO_SECRET_KEY: 'f6a4d066-d976-4143-b8e4-cebf24d981b6',
        JIO_SECRET_ID: '6927fac2a34077bfc4bd45a2',
        JIO_ASSISTANT_ID: '6927fac2a34077bfc4bd45a2',
        NODE_OPTIONS: '--max-old-space-size=2048',
        KAFKAJS_NO_PARTITIONER_WARNING: '1'
      },
      wait_ready: true,
      listen_timeout: 10000,
      max_memory_restart: '500M',
      min_uptime: '30s',
      max_restarts: 5
    },
    {
      name: 'webhook-consumer',
      script: 'src/workers/webhookConsumer.js',
      instances: 8,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
        MONGODB_URI: 'mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority',
        KAFKA_BROKER: 'localhost:9092',
        KAFKAJS_NO_PARTITIONER_WARNING: '1'
      },
      restart_delay: 10000,
      max_memory_restart: '400M',
      min_uptime: '30s',
      max_restarts: 5,
      kill_timeout: 5000
    },
    {
      name: 'stats-consumer',
      script: 'src/workers/statsConsumer.js',
      instances: 6,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
        MONGODB_URI: 'mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority',
        KAFKA_BROKER: 'localhost:9092',
        KAFKAJS_NO_PARTITIONER_WARNING: '1'
      },
      restart_delay: 10000,
      max_memory_restart: '300M',
      min_uptime: '30s',
      max_restarts: 5,
      kill_timeout: 5000
    },
    {
      name: 'batch-consumer',
      script: 'src/workers/batchEntriesConsumer.js',
      instances: 3,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
        MONGODB_URI: 'mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority',
        KAFKA_BROKER: 'localhost:9092',
        KAFKAJS_NO_PARTITIONER_WARNING: '1'
      },
      restart_delay: 10000,
      max_memory_restart: '400M',
      min_uptime: '30s',
      max_restarts: 5,
      kill_timeout: 5000
    },
    {
      name: 'expire-pending-cron',
      script: 'scripts/expirePendingMessages.js',
      instances: 1,
      exec_mode: 'fork',
      cron_restart: '*/5 * * * *',
      autorestart: false,
      env: {
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority'
      }
    }
  ]
};
