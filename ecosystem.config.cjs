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
        MONGODB_URI: 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority',
        // Cloudinary
        CLOUDINARY_CLOUD_NAME: 'krunalvegda02',
        CLOUDINARY_API_KEY: '528136484569676',
        CLOUDINARY_API_SECRET: 'n2mD1KDBgelVDRstn2ZlD8F6jrY',
        // JWT
        JWT_SECRET: 'Z9a8xM!2kP@7Lq1dFhR3CwdwdwdWnA5SeTQ',
        JWT_REFRESH_SECRET: 'Qp7FJc2Z01W5R!D6xB8dwdwLHTeKaM',
        JWT_EXPIRE: '1d',
        JWT_REFRESH_EXPIRE: '7d',
        // CORS
        CORS_ORIGIN: 'https://www.rcssender.com/',
        FRONTEND_URL: 'https://rcssender.com/',
        // Jio RCS
        JIO_ENV: 'production',
        JIOAPI_BASE_URL: 'https://api.businessmessaging.jio.com',
        JIO_SECRET_KEY: 'f6a4d066-d976-4143-b8e4-cebf24d981b6',
        JIO_SECRET_ID: '6927fac2a34077bfc4bd45a2',
        JIO_ASSISTANT_ID: '6927fac2a34077bfc4bd45a2'
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
        MONGODB_URI: 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority'
      },
      wait_ready: true,
      listen_timeout: 10000,
      restart_delay: 5000
    }
  ]
};