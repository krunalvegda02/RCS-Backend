import User from "../models/user.model.js";

export const createAdmin = async () => {
    try {
        const existingAdmin = await User.findOne({ role: "ADMIN" });

        if (!existingAdmin) {
            console.log("No admin found, creating default admin...");

            const adminUser = await User.create({
                email: "admin@gmail.com",
                password: "123456",
                role: "ADMIN",
                name: "Admin",
                phone: "1234567890",
                status: "ACTIVE",
                wallet: { balance: 10000 },
                jioRcsConfig: {
                    secretKey: process.env.JIO_SECRET_KEY || '',
                    secretId: process.env.JIO_SECRET_ID || '',
                    assistantId: process.env.JIO_ASSISTANT_ID || ''
                }
            }).catch(err => {
                if (err.code === 11000) {
                    throw new Error('Admin user already exists with this email or phone');
                }
                if (err.name === 'ValidationError') {
                    throw new Error(`Validation failed: ${Object.values(err.errors).map(e => e.message).join(', ')}`);
                }
                throw err;
            });

            console.log("✅ Admin created successfully:", {
                id: adminUser._id,
                email: adminUser.email,
                role: adminUser.role
            });
        } else {
            console.log("✅ Admin already exists:", {
                id: existingAdmin._id,
                email: existingAdmin.email,
                role: existingAdmin.role
            });
        }
    } catch (error) {
        console.error("❌ Admin creation failed:", error.message);
        if (error.code !== 11000) {
            throw error;
        }
    }
}