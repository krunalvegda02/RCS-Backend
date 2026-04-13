import { connectWithRetry, closeConnection, setupGracefulShutdown } from './mongoConnection.js';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('[ArchiveCron] ❌ MONGODB_URI environment variable is not set');
  process.exit(1);
}

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('[ArchiveCron] ❌ Cloudinary environment variables are not set');
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Setup graceful shutdown
setupGracefulShutdown();

async function archiveOldCampaigns() {
  try {
    await connectWithRetry();
    console.log('[ArchiveCron] Connected to MongoDB');

    // Import models
    const User = (await import('../src/models/user.model.js')).default;
    const Campaign = (await import('../src/models/campaign.model.js')).default;
    const ContactCampaignMessage = (await import('../src/models/contactMessage.model.js')).default;
    const ArchivedCampaign = (await import('../src/models/archivedCampaign.model.js')).default;

    // Check if campaign ID is provided as argument. for testing purposes
    const campaignId = process.argv[2];
    let oldCampaigns;

    if (campaignId) {
      console.log(`[ArchiveCron] Archiving specific campaign: ${campaignId}`);
      const campaign = await Campaign.findById(campaignId).lean();
      
      if (!campaign) {
        console.log('[ArchiveCron] Campaign not found');
        await mongoose.disconnect();
        process.exit(1);
      }

      // Populate user data manually to handle deleted users
      if (campaign.userId) {
        const user = await User.findById(campaign.userId).select('name email').lean();
        campaign.userId = user || { _id: campaign.userId, name: 'Deleted User', email: 'N/A' };
      } else {
        campaign.userId = { name: 'Unknown User', email: 'N/A' };
      }
      
      oldCampaigns = [campaign];
    } else {
      // Calculate cutoff date (1 month ago)
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - 1);

      console.log(`[ArchiveCron] Finding campaigns older than ${cutoffDate.toISOString()}`);

      // Find old campaigns
      oldCampaigns = await Campaign.find({
        createdAt: { $lt: cutoffDate },
        status: 'settled'
      }).lean();

      // Populate user data manually to handle deleted users
      for (const campaign of oldCampaigns) {
        if (campaign.userId) {
          const user = await User.findById(campaign.userId).select('name email').lean();
          campaign.userId = user || { name: 'Deleted User', email: 'N/A' };
        } else {
          campaign.userId = { name: 'Unknown User', email: 'N/A' };
        }
      }
    }

    if (oldCampaigns.length === 0) {
      console.log('[ArchiveCron] No old campaigns to archive');
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log(`[ArchiveCron] Found ${oldCampaigns.length} campaigns to archive`);

    for (const campaign of oldCampaigns) {
      try {
        console.log(`[ArchiveCron] Processing campaign ${campaign._id} (${campaign.name})`);

        // Count total messages
        const totalMessages = await ContactCampaignMessage.countDocuments({ campaignId: campaign._id });
        console.log(`[ArchiveCron] Campaign has ${totalMessages} messages`);

        // Create Excel workbook (matching Orders.jsx format)
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Campaign Messages');
        
        // Define columns matching Orders.jsx export format
        sheet.columns = [
          { header: 'S.No', key: 'sno', width: 8 },
          { header: 'Phone Number', key: 'phone', width: 15 },
          { header: 'Status', key: 'status', width: 12 },
          { header: 'Template Type', key: 'templateType', width: 15 },
          { header: 'Queued At', key: 'queuedAt', width: 20 },
          { header: 'Sent At', key: 'sentAt', width: 20 },
          { header: 'Delivered At', key: 'deliveredAt', width: 20 },
          { header: 'Read At', key: 'readAt', width: 20 },
          { header: 'Failed At', key: 'failedAt', width: 20 },
          { header: 'Interactions', key: 'interactions', width: 12 },
          { header: 'Replies', key: 'replies', width: 10 },
          { header: 'User Response', key: 'userResponse', width: 30 },
          { header: 'Error', key: 'error', width: 30 }
        ];

        // Fetch and add messages in batches to avoid memory issues
        const BATCH_SIZE = 5000;
        let processedCount = 0;
        let rowIndex = 1;

        for (let skip = 0; skip < totalMessages; skip += BATCH_SIZE) {
          const messages = await ContactCampaignMessage.find({ campaignId: campaign._id })
            .skip(skip)
            .limit(BATCH_SIZE)
            .lean();

          const rows = messages.map(msg => ({
            sno: rowIndex++,
            phone: msg.recipientPhoneNumber || 'N/A',
            status: msg.status?.toUpperCase() || 'N/A',
            templateType: 'RCS',
            queuedAt: msg.queuedAt ? new Date(msg.queuedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
            sentAt: msg.sentAt ? new Date(msg.sentAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
            deliveredAt: msg.deliveredAt ? new Date(msg.deliveredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
            readAt: msg.readAt ? new Date(msg.readAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
            failedAt: msg.failedAt ? new Date(msg.failedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
            interactions: msg.userClickCount || 0,
            replies: msg.userReplyCount || 0,
            userResponse: msg.userText || msg.clickedAction || msg.suggestionResponse?.plainText || 'N/A',
            error: (msg.status === 'failed' || msg.status === 'bounced') ? (msg.errorMessage || msg.errorCode || 'Unknown') : 'N/A'
          }));

          sheet.addRows(rows);
          processedCount += messages.length;
          console.log(`[ArchiveCron] Added ${processedCount}/${totalMessages} messages to Excel`);
        }

        // Style header row
        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };

        // Generate Excel buffer
        console.log('[ArchiveCron] Generating Excel file...');
        const buffer = await workbook.xlsx.writeBuffer();
        const fileSizeInMB = buffer.length / 1024 / 1024;
        console.log(`[ArchiveCron] Excel file size: ${fileSizeInMB.toFixed(2)} MB`);

        // Check if file size exceeds 10MB (use 9.5MB as safe threshold)
        const MAX_FILE_SIZE_MB = 9.5; // Safe margin below Cloudinary's 10MB limit
        const CLOUDINARY_LIMIT_BYTES = 10485760; // Cloudinary's actual limit in bytes
        let uploadResults = [];

        if (fileSizeInMB > MAX_FILE_SIZE_MB) {
          console.log(`[ArchiveCron] File size exceeds ${MAX_FILE_SIZE_MB}MB, splitting into chunks...`);
          
          // Calculate rows per chunk with safety margin
          const totalRows = totalMessages;
          const avgBytesPerRow = buffer.length / totalRows;
          const safeRowsPerChunk = Math.floor((CLOUDINARY_LIMIT_BYTES * 0.95) / avgBytesPerRow); // 95% of limit for safety
          const totalChunks = Math.ceil(totalRows / safeRowsPerChunk);
          
          console.log(`[ArchiveCron] Average bytes per row: ${avgBytesPerRow.toFixed(2)}`);
          console.log(`[ArchiveCron] Splitting ${totalRows} rows into ${totalChunks} chunks (~${safeRowsPerChunk} rows each)`);

          // Create chunks
          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const startRow = chunkIndex * safeRowsPerChunk;
            const endRow = Math.min(startRow + safeRowsPerChunk, totalRows);
            
            console.log(`[ArchiveCron] Creating chunk ${chunkIndex + 1}/${totalChunks} (rows ${startRow + 1}-${endRow})`);
            
            // Create new workbook for this chunk
            const chunkWorkbook = new ExcelJS.Workbook();
            const chunkSheet = chunkWorkbook.addWorksheet('Campaign Messages');
            
            // Define columns
            chunkSheet.columns = [
              { header: 'S.No', key: 'sno', width: 8 },
              { header: 'Phone Number', key: 'phone', width: 15 },
              { header: 'Status', key: 'status', width: 12 },
              { header: 'Template Type', key: 'templateType', width: 15 },
              { header: 'Queued At', key: 'queuedAt', width: 20 },
              { header: 'Sent At', key: 'sentAt', width: 20 },
              { header: 'Delivered At', key: 'deliveredAt', width: 20 },
              { header: 'Read At', key: 'readAt', width: 20 },
              { header: 'Failed At', key: 'failedAt', width: 20 },
              { header: 'Interactions', key: 'interactions', width: 12 },
              { header: 'Replies', key: 'replies', width: 10 },
              { header: 'User Response', key: 'userResponse', width: 30 },
              { header: 'Error', key: 'error', width: 30 }
            ];

            // Fetch messages for this chunk
            const chunkMessages = await ContactCampaignMessage.find({ campaignId: campaign._id })
              .skip(startRow)
              .limit(safeRowsPerChunk)
              .lean();

            const chunkRows = chunkMessages.map((msg, idx) => ({
              sno: startRow + idx + 1,
              phone: msg.recipientPhoneNumber || 'N/A',
              status: msg.status?.toUpperCase() || 'N/A',
              templateType: 'RCS',
              queuedAt: msg.queuedAt ? new Date(msg.queuedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
              sentAt: msg.sentAt ? new Date(msg.sentAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
              deliveredAt: msg.deliveredAt ? new Date(msg.deliveredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
              readAt: msg.readAt ? new Date(msg.readAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
              failedAt: msg.failedAt ? new Date(msg.failedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
              interactions: msg.userClickCount || 0,
              replies: msg.userReplyCount || 0,
              userResponse: msg.userText || msg.clickedAction || msg.suggestionResponse?.plainText || 'N/A',
              error: (msg.status === 'failed' || msg.status === 'bounced') ? (msg.errorMessage || msg.errorCode || 'Unknown') : 'N/A'
            }));

            chunkSheet.addRows(chunkRows);

            // Style header row
            chunkSheet.getRow(1).font = { bold: true };
            chunkSheet.getRow(1).fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE0E0E0' }
            };

            // Generate chunk buffer
            const chunkBuffer = await chunkWorkbook.xlsx.writeBuffer();
            const chunkSizeMB = chunkBuffer.length / 1024 / 1024;
            const chunkSizeBytes = chunkBuffer.length;
            console.log(`[ArchiveCron] Chunk ${chunkIndex + 1} size: ${chunkSizeMB.toFixed(2)} MB (${chunkSizeBytes} bytes)`);

            // Verify chunk is under Cloudinary limit
            if (chunkSizeBytes > CLOUDINARY_LIMIT_BYTES) {
              console.error(`[ArchiveCron] ❌ Chunk ${chunkIndex + 1} exceeds Cloudinary limit! ${chunkSizeBytes} > ${CLOUDINARY_LIMIT_BYTES}`);
              throw new Error(`Chunk ${chunkIndex + 1} size ${chunkSizeBytes} bytes exceeds Cloudinary limit of ${CLOUDINARY_LIMIT_BYTES} bytes`);
            }

            // Upload chunk to Cloudinary
            console.log(`[ArchiveCron] Uploading chunk ${chunkIndex + 1}/${totalChunks} to Cloudinary...`);
            const chunkUploadResult = await new Promise((resolve, reject) => {
              const uploadStream = cloudinary.uploader.upload_stream(
                {
                  resource_type: 'raw',
                  folder: 'archived_campaigns',
                  public_id: `campaign-${campaign.name.replace(/[^a-zA-Z0-9]/g, '_')}-${campaign._id}-part${chunkIndex + 1}-${Date.now()}`,
                  format: 'xlsx',
                  access_mode: 'public',
                  flags: 'attachment'
                },
                (error, result) => {
                  if (error) {
                    console.error(`[ArchiveCron] Cloudinary upload error for chunk ${chunkIndex + 1}:`, error);
                    reject(error);
                  } else {
                    console.log(`[ArchiveCron] Chunk ${chunkIndex + 1} uploaded: ${result.secure_url}`);
                    resolve(result);
                  }
                }
              );
              
              const stream = Readable.from(chunkBuffer);
              stream.on('error', (error) => {
                console.error(`[ArchiveCron] Stream error for chunk ${chunkIndex + 1}:`, error);
                reject(error);
              });
              
              stream.pipe(uploadStream);
            });

            uploadResults.push({
              url: chunkUploadResult.secure_url,
              publicId: chunkUploadResult.public_id,
              size: chunkBuffer.length,
              partNumber: chunkIndex + 1,
              totalParts: totalChunks,
              rowsStart: startRow + 1,
              rowsEnd: endRow
            });
          }

          console.log(`[ArchiveCron] ✅ All ${totalChunks} chunks uploaded successfully`);
        } else {
          // File is under 10MB, upload as single file
          console.log('[ArchiveCron] Uploading to Cloudinary...');
          const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                resource_type: 'raw',
                folder: 'archived_campaigns',
                public_id: `campaign-${campaign.name.replace(/[^a-zA-Z0-9]/g, '_')}-${campaign._id}-${Date.now()}`,
                format: 'xlsx',
                access_mode: 'public',
                flags: 'attachment'
              },
              (error, result) => {
                if (error) {
                  console.error('[ArchiveCron] Cloudinary upload error:', error);
                  reject(error);
                } else {
                  console.log('[ArchiveCron] Cloudinary upload success:', result.secure_url);
                  resolve(result);
                }
              }
            );
            
            const stream = Readable.from(buffer);
            stream.on('error', (error) => {
              console.error('[ArchiveCron] Stream error:', error);
              reject(error);
            });
            
            stream.pipe(uploadStream);
          });

          uploadResults.push({
            url: uploadResult.secure_url,
            publicId: uploadResult.public_id,
            size: buffer.length,
            partNumber: 1,
            totalParts: 1,
            rowsStart: 1,
            rowsEnd: totalMessages
          });
        }

        // Verify Excel files are properly accessible
        console.log(`[ArchiveCron] 📁 Total parts: ${uploadResults.length}`);
        uploadResults.forEach((result, idx) => {
          console.log(`[ArchiveCron] 📁 Part ${idx + 1}: ${result.url}`);
          console.log(`[ArchiveCron] 📁 Size: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
          console.log(`[ArchiveCron] 📁 Rows: ${result.rowsStart}-${result.rowsEnd}`);
        });

        // Save archived campaign record to database
        await ArchivedCampaign.create({
          campaignId: campaign._id.toString(),
          campaignName: campaign.name,
          userId: campaign.userId._id || campaign.userId,
          userName: campaign.userId.name || 'Deleted User',
          userEmail: campaign.userId.email || 'N/A',
          botId: campaign.botId,
          excelUrl: uploadResults[0].url, // Primary URL (first part or single file)
          excelParts: uploadResults.length > 1 ? uploadResults : undefined, // Store all parts if chunked
          cloudinaryPublicId: uploadResults[0].publicId,
          fileSize: uploadResults.reduce((sum, r) => sum + r.size, 0),
          totalMessages: totalMessages,
          stats: {
            total: campaign.stats?.total || 0,
            sent: campaign.stats?.sent || 0,
            delivered: campaign.stats?.delivered || 0,
            read: campaign.stats?.read || 0,
            failed: campaign.stats?.failed || 0,
            expired: campaign.stats?.expired || 0
          },
          estimatedCost: campaign.estimatedCost || 0,
          actualCost: campaign.actualCost || 0,
          refundedAmount: campaign.refundedAmount || 0,
          campaignCreatedAt: campaign.createdAt,
          campaignCompletedAt: campaign.completedAt
        });
        console.log(`[ArchiveCron] ✅ Archived campaign ${campaign._id} (${totalMessages} messages)`);
        console.log(`[ArchiveCron] 💾 Saved archived campaign record to database`);

        // Delete messages in batches to avoid overload
        console.log('[ArchiveCron] Deleting messages in batches...');
        const DELETE_BATCH_SIZE = 1000;
        let deletedCount = 0;

        while (deletedCount < totalMessages) {
          // Find batch of message IDs
          const messagesToDelete = await ContactCampaignMessage.find({ campaignId: campaign._id })
            .select('_id')
            .limit(DELETE_BATCH_SIZE)
            .lean();
          
          if (messagesToDelete.length === 0) break;
          
          const ids = messagesToDelete.map(m => m._id);
          const result = await ContactCampaignMessage.deleteMany({ _id: { $in: ids } });
          deletedCount += result.deletedCount;
          
          console.log(`[ArchiveCron] Deleted ${deletedCount}/${totalMessages} messages`);
          await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between batches
        }

        console.log(`[ArchiveCron] ✅ Deleted ${deletedCount} messages for campaign ${campaign._id}`);

        // Delete campaign
        await Campaign.deleteOne({ _id: campaign._id });
        console.log(`[ArchiveCron] ✅ Deleted campaign ${campaign._id}`);
        console.log('---');

      } catch (error) {
        console.error(`[ArchiveCron] ❌ Error archiving campaign ${campaign._id}:`, error.message);
      }
    }

    console.log('[ArchiveCron] ✅ Archive process completed');
    await closeConnection();
    process.exit(0);

  } catch (error) {
    console.error('[ArchiveCron] ❌ Fatal error:', error);
    await closeConnection();
    process.exit(1);
  }
}

archiveOldCampaigns();
