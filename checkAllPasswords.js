import mongoose from 'mongoose';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const CURRENT_KEY = process.env.PASSWORD_ENCRYPTION_KEY || 'Z9a8xM2kP7Lq1dFhR3CwdwdwdWnA5Se';
const OLD_KEY = 'your-32-character-secret-key!!';
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

async function checkAll() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const users = await User.find({}).select('+password');

    console.log(`=== ALL USERS PASSWORD STATUS ===\n`);
    console.log(`Current KEY: ${CURRENT_KEY}\n`);

    for (const user of users) {
      const decryptedCurrent = decryptPassword(user.password, CURRENT_KEY);
      const decryptedOld = decryptPassword(user.password, OLD_KEY);
      const isBcrypt = user.password?.startsWith('$2a$') || user.password?.startsWith('$2b$');
      
      console.log(`${user.email}`);
      console.log(`  Current Key: ${decryptedCurrent ? '✓ ' + decryptedCurrent : '✗ FAILED'}`);
      console.log(`  Old Key: ${decryptedOld ? '✓ ' + decryptedOld : '✗ FAILED'}`);
      console.log(`  Bcrypt: ${isBcrypt ? 'YES' : 'NO'}`);
      console.log('');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAll();
