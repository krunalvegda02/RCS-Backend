const JIO_ENV = process.env.JIO_ENV || 'sandbox';

const isSandbox = JIO_ENV === 'sandbox';
const isProduction = JIO_ENV === 'production';

const config = {
  env: JIO_ENV,

  apiBaseUrl: isSandbox
    ? process.env.JIO_SANDBOX_API_BASE_URL
    : process.env.JIO_PROD_API_BASE_URL,

  secretKey: isSandbox
    ? process.env.JIO_SANDBOX_SECRET_KEY
    : process.env.JIO_PROD_SECRET_KEY,

  secretId: isSandbox
    ? process.env.JIO_SANDBOX_SECRET_ID
    : process.env.JIO_PROD_SECRET_ID,

  assistantId: isSandbox
    ? process.env.JIO_SANDBOX_ASSISTANT_ID
    : process.env.JIO_PROD_ASSISTANT_ID,
};

// 🚨 Safety check
if (!config.secretKey || !config.secretId || !config.assistantId) {
  throw new Error(`❌ Missing Jio RCS config for ${JIO_ENV} environment`);
}

export default config;
