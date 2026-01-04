import mongoose from 'mongoose';
import User from '../src/models/user.model.js';
import dotenv from 'dotenv';

dotenv.config();

const resetPassword = async (email, newPassword) => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      console.log('User not found');
      process.exit(1);
    }

    console.log('User found:', user.email);
    console.log('Old encrypted password:', user.password);
    
    // Update password (will be encrypted by pre-save hook)
    user.password = newPassword;
    await user.save();
    
    // Verify the new password
    const updatedUser = await User.findOne({ email }).select('+password');
    console.log('New encrypted password:', updatedUser.password);
    console.log('Decrypted password:', updatedUser.getDecryptedPassword());
    
    // Test login
    const isValid = await updatedUser.comparePassword(newPassword);
    console.log(`\nPassword "${newPassword}" is valid:`, isValid);
    
    console.log('\n✅ Password reset successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.log('Usage: node scripts/resetPassword.js <email> <new-password>');
  process.exit(1);
}

resetPassword(email, newPassword);
