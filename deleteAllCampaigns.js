import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Campaign from './src/models/campaign.model.js';
import User from './src/models/user.model.js';

dotenv.config();

const deleteAllCampaigns = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get user email from command line or use default
    const userEmail = process.argv[2];
    
    if (!userEmail) {
      console.log('Usage: node deleteAllCampaigns.js <user-email>');
      console.log('Example: node deleteAllCampaigns.js user@example.com');
      process.exit(1);
    }

    // Find user by email
    const user = await User.findOne({ email: userEmail });
    
    if (!user) {
      console.log(`User with email ${userEmail} not found`);
      process.exit(1);
    }

    console.log(`Found user: ${user.name} (${user.email})`);
    console.log(`User ID: ${user._id}`);

    // Count campaigns before deletion
    const count = await Campaign.countDocuments({ userId: user._id });
    console.log(`\nFound ${count} campaigns to delete`);

    if (count === 0) {
      console.log('No campaigns to delete');
      process.exit(0);
    }

    // Delete all campaigns for this user
    const result = await Campaign.deleteMany({ userId: user._id });
    
    console.log(`\n✅ Successfully deleted ${result.deletedCount} campaigns`);
    
    // Also delete ContactBatches if they exist
    try {
      const ContactBatch = (await import('./src/models/contactBatch.model.js')).default;
      const batchResult = await ContactBatch.deleteMany({ userId: user._id });
      console.log(`✅ Successfully deleted ${batchResult.deletedCount} contact batches`);
    } catch (error) {
      console.log('Note: ContactBatch model not found or no batches to delete');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

deleteAllCampaigns();
