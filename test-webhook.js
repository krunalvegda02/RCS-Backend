import axios from 'axios';

// Test if your webhook endpoint is accessible
async function testWebhook() {
  try {
    console.log('🧪 Testing webhook endpoint...');
    
    const response = await axios.post('https://rcssender.com/api/v1/jio/rcs/webhooks', {
      entityType: "STATUS_EVENT",
      entity: {
        eventType: "MESSAGE_DELIVERED",
        messageId: "test-123",
        sendTime: new Date().toISOString()
      },
      userPhoneNumber: "9999999999"
    });
    
    console.log('✅ Webhook endpoint is working!');
    console.log('Response:', response.data);
    
  } catch (error) {
    console.error('❌ Webhook endpoint failed:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

testWebhook();