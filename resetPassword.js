import mongoose from 'mongoose';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const ENCRYPTION_KEY = process.env.PASSWORD_ENCRYPTION_KEY || 'your-32-character-secret-key!!';
const IV_LENGTH = 16;

function encryptPassword(password) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
  let encrypted = cipher.update(password);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

async function resetPassword() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const email = process.argv[2];
    const newPassword = process.argv[3];

    if (!email || !newPassword) {
      console.log('Usage: node resetPassword.js <email> <newPassword>');
      process.exit(1);
    }

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log('User not found');
      process.exit(1);
    }

    const encryptedPassword = encryptPassword(newPassword);
    await User.updateOne({ _id: user._id }, { password: encryptedPassword });

    console.log(`Password updated for ${email}`);
    console.log(`New password: ${newPassword}`);
    console.log(`Encrypted: ${encryptedPassword}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

resetPassword();
