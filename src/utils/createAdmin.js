import User from "../models/user.model.js";
import MESSAGE from "../constants/message.js";

export const createAdmin = async () => {
    try {
        const admin = await User.findOne({ email: "admin@gmail.com" });

        if (!admin) {
            console.log("Admin Not Registered, Creating Admin: Email = admin@gmail.com, Password: 123456");

            const registerAdmin = await User.create({
                email: "admin@gmail.com",
                password: "123456",
                role: "SUPER_ADMIN",
                name: "Super Admin",
                phone: "1234567890",
                status: "ACTIVE"
            });

            console.log("Admin registered successfully:", {
                _id: registerAdmin._id,
                name: registerAdmin.name,
                email: registerAdmin.email,
                role: registerAdmin.role
            });
        } else {
            console.log("Admin already exists:", {
                _id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role
            });
        }
    } catch (error) {
        console.error("Admin Registration error:", error.message);
        console.error(MESSAGE.ADMIN_REGISTER_FAILED);
    }
}