import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from 'mongoose';
import User from '../src/models/user.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const verifyAllUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const result = await User.updateMany(
      {},
      { 
        $set: { 
          onboardingStatus: 'VERIFIED'
        } 
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} users to VERIFIED status`);
    
    const users = await User.find({}, 'email onboardingStatus');
    console.log('\n📋 All users:');
    users.forEach(user => {
      console.log(`  - ${user.email}: ${user.onboardingStatus}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

verifyAllUsers();
