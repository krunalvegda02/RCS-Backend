import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function unlockAccount() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    
    const email = process.argv[2] || 'admin@gmail.com';
    
    const user = await User.findOne({ email });
    
    if (!user) {
      console.log('User not found');
      process.exit(1);
    }

    console.log(`User: ${user.email}`);
    console.log(`Login Attempts: ${user.loginAttempts || 0}`);
    console.log(`Lock Until: ${user.lockUntil || 'Not locked'}`);
    
    await User.updateOne(
      { email },
      { 
        $unset: { loginAttempts: 1, lockUntil: 1 },
        $set: { lastLogin: new Date() }
      }
    );

    console.log('\n✓ Account unlocked successfully!');
    console.log('Login attempts reset to 0');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

unlockAccount();
