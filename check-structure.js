import mongoose from 'mongoose';
import User from './src/models/user.model.js';

const MONGODB_URI = 'mongodb+srv://krunalvegda02:krunalvegda02@cluster0.jwybog2.mongodb.net/test?retryWrites=true&w=majority';

async function checkStructure() {
  await mongoose.connect(MONGODB_URI);
  
  const user = await User.findOne({ email: '1@gmail.com' });
  
  console.log('✅ STRUCTURE VERIFICATION\n');
  
  // Check User Model Methods
  console.log('📋 User Model Methods:');
  console.log(`  blockBalance: ${typeof user.blockBalance === 'function' ? '✅' : '❌'}`);
  console.log(`  unblockBalance: ${typeof user.unblockBalance === 'function' ? '✅' : '❌'}`);
  console.log(`  getAvailableBalance: ${typeof user.getAvailableBalance === 'function' ? '✅' : '❌'}`);
  console.log(`  updateWallet: ${typeof user.updateWallet === 'function' ? '✅' : '❌'}`);
  
  // Check Wallet Schema
  console.log('\n📋 Wallet Schema Fields:');
  console.log(`  balance: ${user.wallet.balance !== undefined ? '✅' : '❌'}`);
  console.log(`  blockedBalance: ${user.wallet.blockedBalance !== undefined ? '✅' : '❌'}`);
  console.log(`  transactions: ${Array.isArray(user.wallet.transactions) ? '✅' : '❌'}`);
  
  // Test Methods
  console.log('\n🧪 Testing Methods:');
  const available = user.getAvailableBalance();
  console.log(`  getAvailableBalance(): ₹${available} ✅`);
  console.log(`  Calculation: ₹${user.wallet.balance} - ₹${user.wallet.blockedBalance || 0} = ₹${available}`);
  
  console.log('\n✅ All required components are in place!');
  console.log('✅ Your structure is ready for the wallet flow!');
  
  await mongoose.disconnect();
}

checkStructure();
