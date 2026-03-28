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
        SMTP_HOST: 'smtp.hostinger.com',
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
        KAFKAJS_NO_PARTITIONER_WARNING: '1',
        RAZORPAY_KEY_ID: 'rzp_live_SCrX8CCm5kMyCV',
        RAZORPAY_KEY_SECRET: 'KLtTl913r4STVP2gPAKzWXGu',
        RAZORPAY_WEBHOOK_SECRET: 'largemedia@rcssender123@123@stzk'

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
      instances: 3, // FIXED: Reduced to 1 to prevent duplicates
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
        MONGODB_URI: 'mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority',
        KAFKA_BROKER: 'localhost:9092',
        KAFKAJS_NO_PARTITIONER_WARNING: '1',
        CLOUDINARY_CLOUD_NAME: 'doce6f5xn',
        CLOUDINARY_API_KEY: '646961174768865',
        CLOUDINARY_API_SECRET: 'obQQcEz0sHCyg4AbxzTn-DW1Trc',
        RAZORPAY_KEY_ID: 'rzp_live_SCrX8CCm5kMyCV',
        RAZORPAY_KEY_SECRET: 'KLtTl913r4STVP2gPAKzWXGu',
        RAZORPAY_WEBHOOK_SECRET: 'largemedia@rcssender123@123@stzk'
      },
      restart_delay: 10000,
      max_memory_restart: '800M', // Increased memory for single instance
      min_uptime: '30s',
      max_restarts: 5,
      kill_timeout: 5000
    },
    {
      name: 'stats-consumer',
      script: 'src/workers/statsConsumer.js',
      instances: 1, // 🚀 Reduced from 10 to 3 for better stability
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
        MONGODB_URI: 'mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority',
        KAFKA_BROKER: 'localhost:9092',
        KAFKAJS_NO_PARTITIONER_WARNING: '1',
        CLOUDINARY_CLOUD_NAME: 'doce6f5xn',
        CLOUDINARY_API_KEY: '646961174768865',
        CLOUDINARY_API_SECRET: 'obQQcEz0sHCyg4AbxzTn-DW1Trc',
        RAZORPAY_KEY_ID: 'rzp_live_SCrX8CCm5kMyCV',
        RAZORPAY_KEY_SECRET: 'KLtTl913r4STVP2gPAKzWXGu',
        RAZORPAY_WEBHOOK_SECRET: 'largemedia@rcssender123@123@stzk'
      },
      restart_delay: 5000,
      max_memory_restart: '1500M', // 🚀 High memory for bulk ops
      min_uptime: '30s',
      max_restarts: 3,
      kill_timeout: 10000
    },
    {
      name: 'batch-consumer',
      script: 'src/workers/batchEntriesConsumer.js',
      instances: 1, // 🚀 SCALED: 3 instances for parallel campaign processing
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
        MONGODB_URI: 'mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority',
        KAFKA_BROKER: 'localhost:9092',
        KAFKAJS_NO_PARTITIONER_WARNING: '1',
        CLOUDINARY_CLOUD_NAME: 'doce6f5xn',
        CLOUDINARY_API_KEY: '646961174768865',
        CLOUDINARY_API_SECRET: 'obQQcEz0sHCyg4AbxzTn-DW1Trc',
        RAZORPAY_KEY_ID: 'rzp_live_SCrX8CCm5kMyCV',
        RAZORPAY_KEY_SECRET: 'KLtTl913r4STVP2gPAKzWXGu',
        RAZORPAY_WEBHOOK_SECRET: 'largemedia@rcssender123@123@stzk'
      },
      restart_delay: 10000,
      max_memory_restart: '800M', // Increased for handling larger campaigns
      min_uptime: '30s',
      max_restarts: 3,
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
        MONGODB_URI: 'mongodb+srv://sikarwarvishal75_db_user:Gama%40123@cluster0.whqwih.mongodb.net/rcs?retryWrites=true&w=majority',
        KAFKAJS_NO_PARTITIONER_WARNING: '1',
        CLOUDINARY_CLOUD_NAME: 'doce6f5xn',
        CLOUDINARY_API_KEY: '646961174768865',
        CLOUDINARY_API_SECRET: 'obQQcEz0sHCyg4AbxzTn-DW1Trc',
        RAZORPAY_KEY_ID: 'rzp_live_SCrX8CCm5kMyCV',
        RAZORPAY_KEY_SECRET: 'KLtTl913r4STVP2gPAKzWXGu',
        RAZORPAY_WEBHOOK_SECRET: 'largemedia@rcssender123@123@stzk'
      }
    }
  ]
};




