import Payment, { PAYMENT_STATUS } from '../models/payment.model.js';
import User from '../models/user.model.js';
import {
    createRazorpayOrder,
    verifyPaymentSignature,
    verifyWebhookSignature,
    fetchPaymentDetails,
    getRazorpayKeyId,
} from '../config/razorpay.js';

// Minimum and maximum amount limits (in INR)
const MIN_AMOUNT = 1000;
const MAX_AMOUNT = 10000000; // 1 Crore

/**
 * Create a new payment order
 * POST /api/v1/payment/create-order
 */
export const createOrder = async (req, res) => {
    try {
        const { packageType, customAmount } = req.body; // packageType: 'starter', 'growth', 'enterprise', 'custom'
        const userId = req.user._id;

        // Get user details
        const user = await User.findById(userId).select('name email phone perMessageCharge');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        let baseAmount;
        let creditsToAdd;

        if (!user.perMessageCharge) {
            // Standard tiered pricing - validate package type
            if (packageType === 'starter') {
                baseAmount = 3000;
                creditsToAdd = 10000;
            } else if (packageType === 'growth') {
                baseAmount = 14000;
                creditsToAdd = 50000;
            } else if (packageType === 'enterprise') {
                baseAmount = 25000;
                creditsToAdd = 100000;
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid package type. Choose: starter, growth, or enterprise',
                });
            }
        } else {
            // Custom pricing - validate custom amount
            if (!customAmount || typeof customAmount !== 'number') {
                return res.status(400).json({
                    success: false,
                    message: 'Custom amount is required for enterprise users',
                });
            }

            if (Math.floor(customAmount / user.perMessageCharge) < 100000) {
                return res.status(400).json({
                    success: false,
                    message: 'Minimum recharge is 1,00,000 credits',
                });
            }

            if (customAmount > MAX_AMOUNT) {
                return res.status(400).json({
                    success: false,
                    message: `Maximum amount is ₹${MAX_AMOUNT.toLocaleString('en-IN')}`,
                });
            }

            baseAmount = customAmount;
            creditsToAdd = Math.floor(baseAmount / user.perMessageCharge);
        }

        // Calculate total with GST
        const gstAmount = baseAmount * 0.18;
        const totalAmount = Math.round(baseAmount + gstAmount);

        // Create Razorpay order with notes for reference
        const razorpayOrder = await createRazorpayOrder(totalAmount, 'INR', {
            userId: userId.toString(),
            userEmail: user.email,
            purpose: 'wallet_recharge',
            packageType: packageType || 'custom',
            baseAmount: baseAmount,
        });

        // Create payment record in database
        const payment = new Payment({
            userId,
            razorpayOrderId: razorpayOrder.id,
            amount: totalAmount,
            creditsToAdd,
            currency: 'INR',
            status: PAYMENT_STATUS.CREATED,
            receipt: razorpayOrder.receipt,
            notes: {
                userId: userId.toString(),
                userEmail: user.email,
                perMessageCharge: user.perMessageCharge,
                packageType: packageType || 'custom',
                baseAmount: baseAmount,
            },
        });

        await payment.save();

        console.log(`[Payment] Order created: ${razorpayOrder.id} for user ${userId}, package: ${packageType || 'custom'}, base: ₹${baseAmount}, total: ₹${totalAmount}, credits: ${creditsToAdd}`);

        res.status(201).json({
            success: true,
            message: 'Payment order created successfully',
            data: {
                orderId: razorpayOrder.id,
                amount: razorpayOrder.amount, // Amount in paise
                currency: razorpayOrder.currency,
                keyId: getRazorpayKeyId(),
                creditsToAdd,
                baseAmount,
                gstAmount: Math.round(baseAmount * 0.18),
                totalAmount,
                prefill: {
                    name: user.name,
                    email: user.email,
                    contact: user.phone,
                },
            },
        });
    } catch (error) {
        console.error('[Payment] Create order error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create payment order',
        });
    }
};

/**
 * Verify payment after completion
 * POST /api/v1/payment/verify
 */
export const verifyPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const userId = req.user._id;

        // Validate required fields
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Missing required payment verification fields',
            });
        }

        // Find the payment record
        const payment = await Payment.findByOrderId(razorpay_order_id);
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment order not found',
            });
        }

        // Verify the payment belongs to this user
        if (payment.userId.toString() !== userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized access to payment',
            });
        }

        // Check if already processed (idempotency)
        if (payment.status === PAYMENT_STATUS.CAPTURED) {
            const user = await User.findById(userId).select('wallet');
            return res.json({
                success: true,
                message: 'Payment already verified',
                data: {
                    paymentId: payment.razorpayPaymentId,
                    amount: payment.amount,
                    credits: payment.creditsToAdd,
                    newBalance: user.wallet.balance,
                },
            });
        }

        // Verify signature
        const isValidSignature = verifyPaymentSignature(
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        );

        if (!isValidSignature) {
            console.error(`[Payment] Invalid signature for order: ${razorpay_order_id}`);
            await payment.markAsFailed({
                code: 'SIGNATURE_MISMATCH',
                description: 'Payment signature verification failed',
                reason: 'Invalid signature',
            });

            return res.status(400).json({
                success: false,
                message: 'Payment verification failed - invalid signature',
            });
        }

        // Fetch payment details from Razorpay
        let paymentDetails = {};
        try {
            paymentDetails = await fetchPaymentDetails(razorpay_payment_id);
        } catch (err) {
            console.warn('[Payment] Could not fetch payment details:', err.message);
        }

        // Update payment record
        await payment.markAsCaptured({
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
            method: paymentDetails.method,
            card: paymentDetails.card,
            bank: paymentDetails.bank,
            wallet: paymentDetails.wallet,
            vpa: paymentDetails.vpa,
        });

        // Add credits to user wallet
        const user = await User.findById(userId);
        await user.updateWallet(
            payment.creditsToAdd,
            'add',
            `Razorpay Payment - Order: ${razorpay_order_id.slice(-8)}`,
            null
        );

        // Update payment with wallet transaction reference
        const lastTransaction = user.wallet.transactions[user.wallet.transactions.length - 1];
        payment.walletTransactionId = lastTransaction._id;
        await payment.save();

        console.log(`[Payment] Verified & credited: ${razorpay_payment_id} for user ${userId}, credits: ${payment.creditsToAdd}`);

        res.json({
            success: true,
            message: 'Payment verified successfully',
            data: {
                paymentId: razorpay_payment_id,
                amount: payment.amount,
                credits: payment.creditsToAdd,
                newBalance: user.wallet.balance,
            },
        });
    } catch (error) {
        console.error('[Payment] Verify payment error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Payment verification failed',
        });
    }
};

/**
 * Handle Razorpay webhook
 * POST /api/v1/payment/webhook
 */
export const handleWebhook = async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const body = req.rawBody || JSON.stringify(req.body);

        // Verify webhook signature
        if (!verifyWebhookSignature(body, signature)) {
            console.error('[Payment Webhook] Invalid signature');
            return res.status(400).json({ error: 'Invalid signature' });
        }

        const event = req.body;
        const eventType = event.event;

        console.log(`[Payment Webhook] Received event: ${eventType}`);

        switch (eventType) {
            case 'payment.captured': {
                const paymentData = event.payload.payment.entity;
                const orderId = paymentData.order_id;
                const paymentId = paymentData.id;

                // Find payment record
                const payment = await Payment.findByOrderId(orderId);
                if (!payment) {
                    console.warn(`[Payment Webhook] Order not found: ${orderId}`);
                    return res.json({ received: true });
                }

                // Skip if already processed
                if (payment.status === PAYMENT_STATUS.CAPTURED) {
                    console.log(`[Payment Webhook] Payment already processed: ${orderId}`);
                    return res.json({ received: true });
                }

                // Update payment and credit wallet
                await payment.markAsCaptured({
                    paymentId: paymentId,
                    method: paymentData.method,
                    card: paymentData.card,
                    bank: paymentData.bank,
                    wallet: paymentData.wallet,
                    vpa: paymentData.vpa,
                });

                const user = await User.findById(payment.userId);
                if (user) {
                    await user.updateWallet(
                        payment.creditsToAdd,
                        'add',
                        `Razorpay Payment (Webhook) - Order: ${orderId.slice(-8)}`,
                        null
                    );
                    console.log(`[Payment Webhook] Credits added for user ${user._id}: ${payment.creditsToAdd}`);
                }
                break;
            }

            case 'payment.failed': {
                const paymentData = event.payload.payment.entity;
                const orderId = paymentData.order_id;

                const payment = await Payment.findByOrderId(orderId);
                if (payment && payment.status !== PAYMENT_STATUS.CAPTURED) {
                    await payment.markAsFailed({
                        code: paymentData.error_code,
                        description: paymentData.error_description,
                        reason: paymentData.error_reason,
                    });
                    console.log(`[Payment Webhook] Payment marked as failed: ${orderId}`);
                }
                break;
            }

            default:
                console.log(`[Payment Webhook] Unhandled event type: ${eventType}`);
        }

        res.json({ received: true });
    } catch (error) {
        console.error('[Payment Webhook] Error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
};

/**
 * Get user's payment history
 * GET /api/v1/payment/history
 */
export const getPaymentHistory = async (req, res) => {
    try {
        const userId = req.user._id;
        const { page = 1, limit = 20, status } = req.query;

        const query = { userId };
        if (status) {
            query.status = status;
        }

        const payments = await Payment.find(query)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .select('-razorpaySignature -notes');

        // Add displayStatus to each payment
        const paymentsWithDisplay = payments.map(p => ({
            ...p.toObject(),
            displayStatus: p.displayStatus,
        }));

        const total = await Payment.countDocuments(query);

        // Get payment stats
        const stats = await Payment.getUserPaymentStats(userId);

        res.json({
            success: true,
            data: {
                payments: paymentsWithDisplay,
                stats,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit),
                },
            },
        });
    } catch (error) {
        console.error('[Payment] Get history error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment history',
        });
    }
};

/**
 * Get all payments (Admin only)
 * GET /api/v1/payment/admin/all
 */
export const getAllPayments = async (req, res) => {
    try {
        const { page = 1, limit = 100, status } = req.query;

        const query = {};
        if (status) {
            query.status = status;
        }

        const payments = await Payment.find(query)
            .populate('userId', 'name email phone')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .select('-razorpaySignature');

        // Add displayStatus to each payment
        const paymentsWithDisplay = payments.map(p => ({
            ...p.toObject(),
            displayStatus: p.displayStatus,
        }));

        const total = await Payment.countDocuments(query);

        res.json({
            success: true,
            data: {
                payments: paymentsWithDisplay,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit),
                },
            },
        });
    } catch (error) {
        console.error('[Payment] Get all payments error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payments',
        });
    }
};



export const getPaymentDetails = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user._id;

        const payment = await Payment.findByOrderId(orderId).select('-razorpaySignature');

        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Payment not found',
            });
        }

        // Verify ownership
        if (payment.userId.toString() !== userId.toString() && req.user.role !== 'ADMIN') {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized access to payment',
            });
        }

        res.json({
            success: true,
            data: payment,
        });
    } catch (error) {
        console.error('[Payment] Get details error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment details',
        });
    }
};

/**
 * Download Payment Invoice
 * GET /api/v1/payment/invoice/:orderId
 */



export const downloadInvoice = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user._id;

        const payment = await Payment.findOne({
            razorpayOrderId: orderId,
        }).populate('userId', 'name email company gst address phone');

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        if (
            payment.userId._id.toString() !== userId.toString() &&
            req.user.role !== 'ADMIN'
        ) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        if (payment.status !== PAYMENT_STATUS.CAPTURED) {
            return res.status(400).json({
                success: false,
                message: 'Invoice available only for successful payments',
            });
        }










        // Calculate Bill Number (Incremental count of captured payments up to this one)
        const ORGbillNumber = await Payment.countDocuments({
            status: PAYMENT_STATUS.CAPTURED,
            createdAt: { $lte: payment.createdAt }
        });
        const billNumber = ORGbillNumber + 9;
        const PAGE_WIDTH = 595;
        const MARGIN_X = 40;

        // Precise Columns (Shifted for better spacing)
        const COL = {
            SL: 55,
            DESC: 100,
            PRICE: 320,
            QTY: 405,
            TOTAL: 455
        };

        const WIDTH = {
            SL: 30,
            DESC: 200,
            PRICE: 75,
            QTY: 40,
            TOTAL: 100 // Widened
        };

        const PDFDocument = (await import('pdfkit')).default;
        const fs = (await import('fs')).default;
        const path = (await import('path')).default;
        const axios = (await import('axios')).default;

        // Create document
        const doc = new PDFDocument({ size: 'A4', margin: 0 }); // Zero margin for full bleeds

        res.setHeader('Content-Type', 'application/pdf');
        const isPreview = req.path.includes('/preview/');
        res.setHeader(
            'Content-Disposition',
            isPreview
                ? `inline; filename=Invoice_${payment.razorpayOrderId}.pdf`
                : `attachment; filename=Invoice_${payment.razorpayOrderId}.pdf`
        );

        doc.pipe(res);

        // --- Theme Colors ---
        const theme = {
            primary: '#2563eb',    // Blue Ribbon
            bgHeader: '#e5e7eb',   // Light Grey Header Background
            bgTableHead: '#f3f4f6',
            bgRowEven: '#f9fafb',
            textMain: '#111827',
            textMuted: '#6b7280',
            white: '#ffffff'
        };

        const LOGO_URL =
            'https://res.cloudinary.com/doce6f5xn/image/upload/v1770455132/largemedia-logo-removebg-preview_wuymm4.png';
        const SIGNATURE_URL =
            'https://res.cloudinary.com/doce6f5xn/image/upload/v1770456240/vishal-sign-removebg-preview_sqnjtr.png';


        // Helper: Draw Arrow Ribbon
        const drawRibbon = (x, y, w, h, color) => {
            const arrowDepth = h / 2;
            doc.save();
            doc.fillColor(color);
            doc.path(`M ${x} ${y} L ${x + w - arrowDepth} ${y} L ${x + w} ${y + h / 2} L ${x + w - arrowDepth} ${y + h} L ${x} ${y + h} Z`);
            doc.fill();
            doc.restore();
        };

        // Helper: Format Currency
        const formatCurrency = (amount) => {
            return `INR ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };

        /* ======================================================
           1. TOP HEADER SECTION
        ====================================================== */
        const headerProtoHeight = 160;
        doc.rect(0, 0, PAGE_WIDTH, headerProtoHeight).fill(theme.bgHeader);

        // Tagline (Top Left)
        doc.font('Helvetica-Bold').fontSize(10).fillColor(theme.textMain).text('RCS MESSAGING SOLUTIONS', MARGIN_X, 40);

        // Logo (Below Tagline)
        // Logo (Below Tagline)
        const logoY = 45;
        try {
            const logoResponse = await axios.get(LOGO_URL, { responseType: 'arraybuffer' });
            const logoBuffer = Buffer.from(logoResponse.data);
            doc.image(logoBuffer, MARGIN_X, logoY, { width: 150 });
        } catch (e) {
            console.error('Error fetching invoice logo:', e.message);
            doc.font('Helvetica-Bold').fontSize(24).fillColor(theme.textMain).text('RCS Messaging', MARGIN_X, logoY + 10);
        }

        // "INVOICE" Text (Top Right)
        doc.font('Helvetica-Bold').fontSize(36).fillColor(theme.textMain).text('INVOICE', 0, 40, { align: 'right', width: 555 });

        // Invoice Meta Ribbon (Blue)
        const ribbonY = 124;
        const ribbonHeight = 35;
        drawRibbon(0, ribbonY, 300, ribbonHeight, theme.primary);

        // -- Text inside Ribbon (Horizontal Layout) --

        // 1. Bill # (Left)
        // Adjust spacing for bill number
        doc.font('Helvetica-Bold').fontSize(10).fillColor(theme.white)
            .text('Bill #', MARGIN_X, ribbonY + 11);
        doc.font('Helvetica').fontSize(10).fillColor(theme.white)
            .text(`${billNumber}`, MARGIN_X + 32, ribbonY + 11);

        // 2. Invoice # (Right/Middle of Ribbon)
        const invoiceLabelX = 130;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(theme.white)
            .text('Invoice #', invoiceLabelX, ribbonY + 11);
        doc.font('Helvetica').fontSize(10).fillColor(theme.white)
            .text(payment.razorpayOrderId.slice(-10).toUpperCase(), invoiceLabelX + 50, ribbonY + 11);



        // Date (Right Side)
        doc.font('Helvetica-Bold').fontSize(10).fillColor(theme.textMain).text('Date', 400, ribbonY + 11);
        doc.font('Helvetica').fontSize(10).fillColor(theme.textMain)
            .text(new Date(payment.createdAt).toLocaleDateString('en-GB'), 430, ribbonY + 11);

        /* ======================================================
           2. BILLING SECTION
        ====================================================== */
        const billY = 200;
        const rightColX = 355;
        const rightColWidth = 200;

        // -- Invoice To (User) --
        doc.font('Helvetica-Bold').fontSize(12).fillColor(theme.textMain).text('Invoice To:', MARGIN_X, billY);
        doc.font('Helvetica-Bold').fontSize(11).text(payment.userId.name, MARGIN_X, billY + 20);

        doc.font('Helvetica').fontSize(9).fillColor(theme.textMuted);
        let userY = billY + 35;
        doc.text(payment.userId.email, MARGIN_X, userY);
        userY += 12;

        if (payment.userId.company) {
            doc.text(payment.userId.company, MARGIN_X, userY);
            userY += 12;
        }
        if (payment.userId.gst) {
            doc.text(`GSTIN: ${payment.userId.gst}`, MARGIN_X, userY);
            userY += 12;
        }
        if (payment.userId.address) {
            doc.text(payment.userId.address, MARGIN_X, userY, { width: 200 });
        }


        // -- Pay To (Company) --
        doc.font('Helvetica-Bold').fontSize(12).fillColor(theme.textMain).text('Pay To:', rightColX, billY, { width: rightColWidth, align: 'right' });
        doc.font('Helvetica-Bold').fontSize(11).text('Large Media Solution', rightColX, billY + 20, { width: rightColWidth, align: 'right' });

        doc.font('Helvetica').fontSize(9).fillColor(theme.textMuted);
        let companyY = billY + 35;
        doc.text('3rd floor 316, Vishala empire,', rightColX, companyY, { width: rightColWidth, align: 'right' });
        companyY += 12;
        doc.text('Ring road circle, near dehgam,', rightColX, companyY, { width: rightColWidth, align: 'right' });
        companyY += 12;
        doc.text('GIDC Naroda, Ahmedabad,', rightColX, companyY, { width: rightColWidth, align: 'right' });
        companyY += 12;
        doc.text('Gujarat 382330', rightColX, companyY, { width: rightColWidth, align: 'right' });
        companyY += 12;
        doc.text('GSTIN: 24KTDPS0042G2ZS', rightColX, companyY, { width: rightColWidth, align: 'right' });
        companyY += 12;
        doc.fillColor(theme.primary).text('www.largemedia.in', rightColX, companyY, { width: rightColWidth, align: 'right' }).fillColor(theme.textMuted);


        /* ======================================================
           3. TABLE
        ====================================================== */
        const tableTop = 330;
        const rowHeight = 35;
        const ribbonBreakX = 310;

        // Header Ribbon (Blue Left)
        drawRibbon(MARGIN_X, tableTop, ribbonBreakX - MARGIN_X, rowHeight, theme.primary);

        // Header Background (Grey Right)
        doc.save();
        doc.rect(ribbonBreakX - 20, tableTop, PAGE_WIDTH - (ribbonBreakX - 20) - MARGIN_X, rowHeight).fill(theme.bgHeader);
        doc.restore();

        // Redraw Blue for Layering
        drawRibbon(MARGIN_X, tableTop, ribbonBreakX - MARGIN_X, rowHeight, theme.primary);

        // Header Text
        doc.font('Helvetica-Bold').fontSize(10).fillColor(theme.white);
        doc.text('SL.', COL.SL, tableTop + 12);
        doc.text('Item Description', COL.DESC, tableTop + 12);

        doc.fillColor(theme.textMain);
        doc.text('Price', COL.PRICE, tableTop + 12, { width: WIDTH.PRICE, align: 'right' });
        doc.text('Qty', COL.QTY, tableTop + 12, { width: WIDTH.QTY, align: 'center' });
        doc.text('Total', COL.TOTAL - 10, tableTop + 12, { width: WIDTH.TOTAL, align: 'right' });

        // -- Row Data --
        const totalAmount = payment.amount;
        const baseAmount = Math.round((totalAmount / 1.18) * 100) / 100;
        const gstAmount = totalAmount - baseAmount;
        const rowY = tableTop + rowHeight;

        // Row Bg
        doc.rect(MARGIN_X, rowY, PAGE_WIDTH - MARGIN_X * 2, rowHeight).fill(theme.bgRowEven);

        doc.font('Helvetica-Bold').fontSize(10).fillColor(theme.textMain);
        doc.text('1', COL.SL, rowY + 12);

        doc.font('Helvetica').fontSize(10);
        doc.text(
            `Wallet Recharge - ${payment.creditsToAdd.toLocaleString('en-IN')} Credits`,
            COL.DESC,
            rowY + 12,
            { width: WIDTH.DESC, lineBreak: false, ellipsis: true }
        );

        doc.text(`INR ${baseAmount.toFixed(2)}`, COL.PRICE, rowY + 12, { width: WIDTH.PRICE, align: 'right' });
        doc.text('1', COL.QTY, rowY + 12, { width: WIDTH.QTY, align: 'center' });
        doc.text(`INR ${baseAmount.toFixed(2)}`, COL.TOTAL - 10, rowY + 12, { width: WIDTH.TOTAL, align: 'right' });

        // Spacer Rows
        doc.rect(MARGIN_X, rowY + rowHeight, PAGE_WIDTH - MARGIN_X * 2, rowHeight).fill(theme.white);
        doc.rect(MARGIN_X, rowY + rowHeight * 2, PAGE_WIDTH - MARGIN_X * 2, rowHeight).fill(theme.bgRowEven);


        /* ======================================================
           4. LOWER SECTION (Summary + Terms + Signature)
        ====================================================== */

        const lowerY = rowY + (rowHeight * 3) + 20;

        /* ================= LEFT : PAYMENT INFO ================= */
        doc.font('Helvetica-Bold')
            .fontSize(10)
            .fillColor(theme.textMain)
            .text('Payment Info:', MARGIN_X, lowerY);

        doc.font('Helvetica')
            .fontSize(9)
            .fillColor(theme.textMuted);

        let infoY = lowerY + 15;

        doc.text(`Order ID: ${payment.razorpayOrderId}`, MARGIN_X, infoY, { width: 250 });
        infoY += 14;

        doc.text('Method: Razorpay Gateway', MARGIN_X, infoY);
        infoY += 14;

        doc.text('Status: Received', MARGIN_X, infoY);

        /* ================= RIGHT : TOTAL SUMMARY ================= */
        const totalsLabelX = COL.PRICE + 30;
        const totalsValueX = COL.TOTAL;

        doc.font('Helvetica-Bold')
            .fontSize(10)
            .fillColor(theme.textMain)
            .text('Sub Total:', totalsLabelX, lowerY);

        doc.font('Helvetica')
            .fontSize(10)
            .text(formatCurrency(baseAmount), totalsValueX, lowerY, {
                width: WIDTH.TOTAL,
                align: 'right'
            });

        doc.font('Helvetica-Bold')
            .fontSize(10)
            .text('GST (18%):', totalsLabelX, lowerY + 20);

        doc.font('Helvetica')
            .fontSize(10)
            .text(formatCurrency(gstAmount), totalsValueX, lowerY + 20, {
                width: WIDTH.TOTAL,
                align: 'right'
            });

        /* ================= GRAND TOTAL RIBBON ================= */
        const totalRibbonY = lowerY + 45;

        drawRibbon(totalsLabelX, totalRibbonY, 225, 35, theme.primary);

        doc.font('Helvetica-Bold')
            .fontSize(13)
            .fillColor(theme.white)
            .text('Grand Total', totalsLabelX + 12, totalRibbonY + 10);

        doc.text(
            formatCurrency(totalAmount),
            totalsValueX,
            totalRibbonY + 10,
            { width: WIDTH.TOTAL, align: 'right' }
        );

        /* ======================================================
           5. TERMS & SIGNATURE — SAME ROW (FIXED ALIGNMENT)
        ====================================================== */

        const footerRowY = lowerY + 235;

        /* -------- LEFT : TERMS -------- */
        doc.font('Helvetica-Bold')
            .fontSize(10)
            .fillColor(theme.textMain)
            .text('Terms & Conditions', MARGIN_X, footerRowY);

        doc.font('Helvetica')
            .fontSize(8)
            .fillColor(theme.textMuted)
            .text('1. Payment is non-refundable.', MARGIN_X, footerRowY + 14);

        doc.text('2. Valid for Input Tax Credit.', MARGIN_X, footerRowY + 26);

        /* -------- RIGHT : SIGNATURE (Right Aligned) -------- */
        const signLineY = footerRowY + 22;
        const signLineWidth = 140;
        const signEndX = PAGE_WIDTH - MARGIN_X; // 555
        const signStartX = signEndX - signLineWidth;
        const signCenterX = signStartX + (signLineWidth / 2);

        try {
            const signResponse = await axios.get(SIGNATURE_URL, { responseType: 'arraybuffer' });
            const signBuffer = Buffer.from(signResponse.data);
            // Draw signature centered
            doc.image(signBuffer, signCenterX - 50, signLineY - 45, { width: 100 });
        } catch (e) {
            console.error('Error fetching signature:', e.message);
        }

        doc.strokeColor(theme.textMain)
            .moveTo(signStartX, signLineY)
            .lineTo(signEndX, signLineY)
            .stroke();

        doc.font('Helvetica')
            .fontSize(9)
            .fillColor(theme.textMain)
            .text(
                'Authorised Sign',
                signStartX,
                signLineY + 6,
                { width: signLineWidth, align: 'center' }
            );

        /* -------- OPTIONAL : COMPANY STAMP PLACEHOLDER -------- */
        // doc.font('Helvetica-Oblique')
        //     .fontSize(8)
        //     .fillColor(theme.textMuted)
        //     .text(
        //         'Company Stamp',
        //         totalsLabelX,
        //         signLineY - 35,
        //         { width: WIDTH.TOTAL, align: 'center' }
        //     );

        // doc.rect(
        //     totalsLabelX + 30,
        //     signLineY - 55,
        //     WIDTH.TOTAL - 60,
        //     35
        // ).dash(3).strokeColor('#cbd5e1').stroke().undash();


        /* ======================================================
           5. FOOTER
        ====================================================== */
        const footerY = 780;
        const footerRibbonBreak = 260;

        // 1. Draw Grey Background (Right side)
        doc.save();
        doc.rect(footerRibbonBreak - 20, footerY, PAGE_WIDTH - (footerRibbonBreak - 20), 40).fill(theme.bgHeader);
        doc.restore();

        // 2. Draw Blue Ribbon ON TOP (Left side) to create the arrow overlap
        drawRibbon(0, footerY, footerRibbonBreak, 40, theme.primary);

        // 3. Draw Text ON TOP of Blue Ribbon
        doc.fillColor(theme.white).fontSize(10).text('Thank you for your business', MARGIN_X, footerY + 15, { width: 250 });

        // 4. Draw Website Link ON TOP of Grey Background
        doc.fillColor(theme.primary).text('www.largemedia.in', PAGE_WIDTH - MARGIN_X - 120, footerY + 15, { width: 120, align: 'right' });

        doc.end();

    } catch (error) {
        console.error('[Invoice] Error:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Failed to generate invoice',
            });
        }
    }
};

