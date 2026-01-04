import mongoose from 'mongoose';
import User from '../src/models/user.model.js';
import dotenv from 'dotenv';

dotenv.config();

const checkPassword = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const user = await User.findOne({ email: 'admin@gmail.com' }).select('+password');
    
    if (!user) {
      console.log('User not found');
      process.exit(1);
    }

    console.log('User found:', user.email);
    console.log('Encrypted password:', user.password);
    console.log('Decrypted password:', user.getDecryptedPassword());
    
    // Test password comparison
    const testPassword = '123456';
    console.log(`\nTesting password: "${testPassword}"`);
    const isValid = await user.comparePassword(testPassword);
    console.log('Password is valid:', isValid);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

checkPassword();
