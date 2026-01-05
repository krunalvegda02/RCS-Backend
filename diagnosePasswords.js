import mongoose from 'mongoose';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const CURRENT_KEY = process.env.PASSWORD_ENCRYPTION_KEY || 'your-32-character-secret-key!!';
const OLD_KEY = 'your-32-character-secret-key!!'; // Default fallback
const IV_LENGTH = 16;

function decryptPassword(encryptedPassword, key) {
  try {
    const parts = encryptedPassword.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key.padEnd(32, '0').slice(0, 32)), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    return null;
  }
}

async function diagnosePasswords() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    
    const users = await User.find({ email: { $in: ['admin@gmail.com', '3@gmail.com'] } }).select('+password');

    console.log('=== PASSWORD DIAGNOSIS ===\n');
    console.log(`Current ENCRYPTION_KEY: ${CURRENT_KEY}\n`);

    for (const user of users) {
      console.log(`User: ${user.email}`);
      console.log(`Encrypted Password: ${user.password?.substring(0, 50)}...`);
      
      // Try current key
      const decryptedCurrent = decryptPassword(user.password, CURRENT_KEY);
      console.log(`Decrypt with CURRENT key: ${decryptedCurrent ? 'SUCCESS ✓' : 'FAILED ✗'}`);
      if (decryptedCurrent) console.log(`  Decrypted: ${decryptedCurrent}`);
      
      // Try old/default key
      const decryptedOld = decryptPassword(user.password, OLD_KEY);
      console.log(`Decrypt with OLD/DEFAULT key: ${decryptedOld ? 'SUCCESS ✓' : 'FAILED ✗'}`);
      if (decryptedOld) console.log(`  Decrypted: ${decryptedOld}`);
      
      // Check if bcrypt
      const isBcrypt = user.password?.startsWith('$2a$') || user.password?.startsWith('$2b$');
      console.log(`Is Bcrypt format: ${isBcrypt ? 'YES' : 'NO'}`);
      
      console.log('---\n');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

diagnosePasswords();
