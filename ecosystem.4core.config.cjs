// Optimized for 4+ CPU cores
module.exports = {
  apps: [
    {
      name: 'api',
      script: 'src/index.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        MONGODB_URI: 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority',
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
        JIO_ASSISTANT_ID: '6927fac2a34077bfc4bd45a2'
      }
    },
    {
      name: 'kafka-consumer',
      script: 'src/workers/kafkaConsumer.js',
      instances: 2,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
        MONGODB_URI: 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority',
        KAFKA_BROKER: 'localhost:9092'
      },
      restart_delay: 5000
    },
    {
      name: 'stats-consumer',
      script: 'src/workers/statsConsumer.js',
      instances: 2,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
        MONGODB_URI: 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority',
        KAFKA_BROKER: 'localhost:9092'
      },
      restart_delay: 5000
    },
    {
      name: 'batch-entries-consumer',
      script: 'src/workers/batchEntriesConsumer.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        WORKER_MODE: 'true',
        MONGODB_URI: 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority',
        KAFKA_BROKER: 'localhost:9092'
      },
      restart_delay: 5000
    }
  ]
};
