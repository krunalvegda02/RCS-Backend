import mongoose from 'mongoose';
import Message from './src/models/message.model.js';

const MONGODB_URI = 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/rcs?retryWrites=true&w=majority';

async function checkMessages() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check total messages
    const messageCount = await Message.countDocuments();
    console.log('Total messages in database:', messageCount);

    // Check recent messages
    const recentMessages = await Message.find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .select('messageId jioMessageId rcsMessageId externalMessageId status createdAt')
      .lean();
    
    console.log('Recent messages:');
    recentMessages.forEach(msg => {
      console.log(`- ID: ${msg.messageId}, Status: ${msg.status}, Created: ${msg.createdAt}`);
    });

    // Check for the specific webhook message ID
    const webhookMessageId = '1767201399267_80dcyoiy';
    const specificMessage = await Message.findOne({
      $or: [
        { messageId: webhookMessageId },
        { jioMessageId: webhookMessageId },
        { rcsMessageId: webhookMessageId },
        { externalMessageId: webhookMessageId }
      ]
    });
    
    console.log(`\nWebhook message ${webhookMessageId} found:`, specificMessage ? 'Yes' : 'No');

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkMessages();