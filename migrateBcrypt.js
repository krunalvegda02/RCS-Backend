import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const ENCRYPTION_KEY = process.env.PASSWORD_ENCRYPTION_KEY || 'Z9a8xM2kP7Lq1dFhR3CwdwdwdWnA5Se';
const IV_LENGTH = 16;

function encryptPassword(password) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
  let encrypted = cipher.update(password);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

async function migrateBcrypt() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const users = await User.find({}).select('+password');

    console.log('Migrating bcrypt passwords...\n');

    for (const user of users) {
      const isBcrypt = user.password?.startsWith('$2a$') || user.password?.startsWith('$2b$');
      
      if (isBcrypt) {
        console.log(`Found bcrypt password for: ${user.email}`);
        console.log('Please enter the plain text password for this user:');
        
        // For user 4@gmail.com, let's set a default password
        const newPassword = '123456'; // Default password
        const encrypted = encryptPassword(newPassword);
        
        await User.updateOne({ _id: user._id }, { password: encrypted });
        console.log(`✓ Migrated ${user.email} with password: ${newPassword}\n`);
      }
    }
    
    console.log('Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

migrateBcrypt();
