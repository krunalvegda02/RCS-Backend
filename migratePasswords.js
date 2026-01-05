import mongoose from 'mongoose';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const OLD_KEY = 'your-32-character-secret-key!!';
const NEW_KEY = process.env.PASSWORD_ENCRYPTION_KEY || 'Z9a8xM2kP7Lq1dFhR3CwdwdwdWnA5Se';
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

function encryptPassword(password, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key.padEnd(32, '0').slice(0, 32)), iv);
  let encrypted = cipher.update(password);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

async function migratePasswords() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const users = await User.find({}).select('+password');

    console.log(`Found ${users.length} users\n`);
    console.log(`Migrating from OLD key to NEW key...\n`);

    let migrated = 0;
    for (const user of users) {
      const decrypted = decryptPassword(user.password, OLD_KEY);
      if (decrypted) {
        const reencrypted = encryptPassword(decrypted, NEW_KEY);
        await User.updateOne({ _id: user._id }, { password: reencrypted });
        console.log(`✓ Migrated: ${user.email}`);
        migrated++;
      } else {
        console.log(`✗ Failed: ${user.email} (already using new key or bcrypt)`);
      }
    }

    console.log(`\n${migrated}/${users.length} passwords migrated successfully`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

migratePasswords();
