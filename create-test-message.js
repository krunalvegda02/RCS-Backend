import mongoose from 'mongoose';
import Message from './src/models/message.model.js';
import User from './src/models/user.model.js';

const MONGODB_URI = 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/rcs?retryWrites=true&w=majority';

async function createTestMessage() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get a user
    const user = await User.findOne();
    if (!user) {
      console.log('No users found. Create a user first.');
      return;
    }

    // Create test message with webhook ID
    const testMessage = await Message.create({
      messageId: '1767201399267_80dcyoiy', // The webhook message ID
      userId: user._id,
      recipientPhoneNumber: '919427109237',
      templateId: user._id, // Using user ID as dummy template
      templateType: 'plainText',
      content: { text: 'Test message' },
      status: 'pending'
    });

    console.log('Test message created:', testMessage.messageId);
    console.log('Now webhooks should find this message!');

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

createTestMessage();