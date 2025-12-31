import mongoose from 'mongoose';
import Message from './src/models/message.model.js';

const MONGODB_URI = 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/rcs?retryWrites=true&w=majority';

async function debugMessage() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check for the specific webhook message ID
    const webhookMessageId = '1767202249286_txyuhlwx';
    
    console.log('Looking for message with ID:', webhookMessageId);
    
    // Try all possible field matches
    const queries = [
      { messageId: webhookMessageId },
      { rcsMessageId: webhookMessageId },
      { jioMessageId: webhookMessageId },
      { externalMessageId: webhookMessageId }
    ];
    
    for (const query of queries) {
      const fieldName = Object.keys(query)[0];
      const result = await Message.findOne(query);
      console.log(`${fieldName} match:`, result ? 'FOUND' : 'NOT FOUND');
      if (result) {
        console.log('Found message:', {
          _id: result._id,
          messageId: result.messageId,
          rcsMessageId: result.rcsMessageId,
          jioMessageId: result.jioMessageId,
          externalMessageId: result.externalMessageId,
          status: result.status
        });
      }
    }
    
    // Check total messages
    const total = await Message.countDocuments();
    console.log('\nTotal messages in DB:', total);
    
    // Get latest message to see structure
    const latest = await Message.findOne().sort({ createdAt: -1 });
    if (latest) {
      console.log('\nLatest message structure:');
      console.log('messageId:', latest.messageId);
      console.log('rcsMessageId:', latest.rcsMessageId);
      console.log('jioMessageId:', latest.jioMessageId);
      console.log('externalMessageId:', latest.externalMessageId);
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

debugMessage();