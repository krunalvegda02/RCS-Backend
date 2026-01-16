module.exports = {
  apps: [
    {
      name: 'rcs-api',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'rcs-kafka-consumer',
      script: 'src/workers/kafkaConsumer.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/kafka-error.log',
      out_file: './logs/kafka-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'rcs-batch-consumer',
      script: 'src/workers/batchEntriesConsumer.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/batch-error.log',
      out_file: './logs/batch-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'rcs-stats-consumer',
      script: 'src/workers/statsConsumer.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/stats-error.log',
      out_file: './logs/stats-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 5000
    }
  ],
  
  // Cron jobs
  deploy: {
    production: {
      cron_restart: '*/5 * * * *' // Restart every 5 minutes if needed
    }
  }
};
