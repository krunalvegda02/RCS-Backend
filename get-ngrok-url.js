import axios from 'axios';

async function getNgrokUrl() {
  try {
    const response = await axios.get('http://127.0.0.1:4040/api/tunnels');
    const tunnel = response.data.tunnels.find(t => t.proto === 'https');
    
    if (tunnel) {
      const ngrokUrl = tunnel.public_url;
      console.log(`🔗 Ngrok URL: ${ngrokUrl}`);
      console.log(`📋 Webhook URL: ${ngrokUrl}/api/v1/webhooks/jio/rcs/webhook`);
      console.log(`\n✅ Set this in your .env file:`);
      console.log(`NGROK_URL=${ngrokUrl}`);
      return ngrokUrl;
    } else {
      console.log('❌ No HTTPS tunnel found. Make sure ngrok is running.');
    }
  } catch (error) {
    console.log('❌ Could not connect to ngrok. Make sure it\'s running on port 4040.');
  }
}

getNgrokUrl();