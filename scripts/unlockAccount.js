import mongoose from 'mongoose';
import User from '../src/models/user.model.js';
import dotenv from 'dotenv';

dotenv.config();

const unlockAccount = async (emailOrPhone) => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const user = await User.findByEmailOrPhone(emailOrPhone);
    
    if (!user) {
      console.log('User not found');
      process.exit(1);
    }

    await user.resetLoginAttempts();
    
    console.log(`Account unlocked successfully for: ${user.email}`);
    console.log(`Login attempts reset. User can now login.`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

const emailOrPhone = process.argv[2];

if (!emailOrPhone) {
  console.log('Usage: node scripts/unlockAccount.js <email-or-phone>');
  process.exit(1);
}

unlockAccount(emailOrPhone);
