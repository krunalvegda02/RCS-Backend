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
        CLOUDINARY_CLOUD_NAME: 'krunalvegda02',
        CLOUDINARY_API_KEY: '528136484569676',
        CLOUDINARY_API_SECRET: 'n2mD1KDBgelVDRstn2ZlD8F6jrY',
        JWT_SECRET: 'Z9a8xM!2kP@7Lq1dFhR3CwdwdwdWnA5SeTQ',
        JWT_REFRESH_SECRET: 'Qp7FJc2Z01W5R!D6xB8dwdwLHTeKaM',
        JWT_EXPIRE: '1d',
        JWT_REFRESH_EXPIRE: '7d',
        CORS_ORIGIN: 'https://www.rcssender.com/',
        FRONTEND_URL: 'https://rcssender.com/',
        JIO_ENV: 'production',
        JIOAPI_BASE_URL: 'https://api.businessmessaging.jio.com',
        JIO_SECRET_KEY: 'f6a4d066-d976-4143-b8e4-cebf24d981b6',
        JIO_SECRET_ID: '6927fac2a34077bfc4bd45a2',
        JIO_ASSISTANT_ID: '6927fac2a34077bfc4bd45a2',
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
