import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import User from '../src/models/user.model.js';
import connectDB from '../src/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env vars explicitly like index.js
dotenv.config({
    path: join(__dirname, "../.env"),
});

console.log('Environment Check:');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'SET' : 'MISSING');
console.log('PASSWORD_ENCRYPTION_KEY:', process.env.PASSWORD_ENCRYPTION_KEY ? 'SET' : 'MISSING');

const testLogin = async () => {
    try {
        await connectDB();
        console.log('DB Connected');

        // Find a user (any user)
        const user = await User.findOne().select('+password');
        if (!user) {
            console.log('No users found to test');
            return;
        }

        console.log('Testing user:', user.email);
        console.log('Stored password:', user.password ? user.password.substring(0, 20) + '...' : 'NONE');

        // Test comparePassword (this simulates what auth controller does)
        // We don't know the real password so this will likely return false, but we want to see if it CRASHES.
        console.log('Running comparePassword with dummy password...');
        try {
            const isMatch = await user.comparePassword('testpassword123');
            console.log('comparePassword Result:', isMatch);
        } catch (err) {
            console.error('CRASH in comparePassword:', err);
        }

        process.exit(0);
    } catch (error) {
        console.error('Script Error:', error);
        process.exit(1);
    }
};

testLogin();
