import mongoose from "mongoose";
import pLimit from "p-limit";
// import ContactChecking from "../models/ContactChecking.model.js";

const BATCH_SIZE = 1000;
const CHUNK_SIZE = 2000;
const CONCURRENCY = 5;

const uploadContacts = async (req, res) => {
  try {
    const { campaignId, phoneNumbers } = req.body;

    console.log("uploadContacts started.", new Date().toLocaleString());

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        message: "campaignId is required",
      });
    }

    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "phoneNumbers array is required",
      });
    }

    /* ===============================
       1️⃣ Normalize & dedupe (FAST)
    =============================== */
    const normalizedNumbers = [];
    const seen = new Set();

    for (let i = 0; i < phoneNumbers.length; i++) {
      const num = phoneNumbers[i].trim();
      if (!seen.has(num)) {
        seen.add(num);
        normalizedNumbers.push(num);
      }
    }

    console.log(
      "Normalization completed:",
      normalizedNumbers.length,
      new Date().toLocaleString()
    );

    /* ===============================
       2️⃣ Fetch existing contacts
       PARALLEL + LIMITED
    =============================== */
    const existingMap = new Map();
    const limit = pLimit(CONCURRENCY);
    const tasks = [];

    // for (let i = 0; i < normalizedNumbers.length; i += CHUNK_SIZE) {
    //   const chunk = normalizedNumbers.slice(i, i + CHUNK_SIZE);

    //   tasks.push(
    //     limit(async () => {
    //       const docs = await ContactChecking.find(
    //         { contact: { $in: chunk } },
    //         { contact: 1, isRcsCapable: 1, campaignIds: 1 }
    //       ).lean();

    //       for (const doc of docs) {
    //         existingMap.set(doc.contact, doc);
    //       }
    //     })
    //   );
    // }

    await Promise.all(tasks);

    console.log(
      "Existing map completed:",
      existingMap.size,
      new Date().toLocaleString()
    );

    /* ===============================
       3️⃣ Classify numbers
    =============================== */
    let alreadyRcsCapableCount = 0;
    const bulkUpdates = [];
    const newContacts = [];

    for (const number of normalizedNumbers) {
      const existing = existingMap.get(number);

      if (existing) {
        if (!existing.campaignIds?.some(id => id.toString() === campaignId)) {
          bulkUpdates.push({
            updateOne: {
              filter: { contact: number },
              update: { $addToSet: { campaignIds: campaignId } },
            },
          });
        }

        if (existing.isRcsCapable === true) {
          alreadyRcsCapableCount++;
        }
      } else {
        newContacts.push({
          contact: number,
          campaignIds: [campaignId],
          status: "pending",
          isRcsCapable: null,
        });
      }
    }

    /* ===============================
       4️⃣ Insert new contacts (BATCHED)
    =============================== */
    for (let i = 0; i < newContacts.length; i += BATCH_SIZE) {
      await ContactChecking.insertMany(
        newContacts.slice(i, i + BATCH_SIZE),
        { ordered: false }
      );
    }

    /* ===============================
       5️⃣ Update existing contacts
    =============================== */
    for (let i = 0; i < bulkUpdates.length; i += BATCH_SIZE) {
      await ContactChecking.bulkWrite(
        bulkUpdates.slice(i, i + BATCH_SIZE),
        { ordered: false }
      );
    }

    console.log("uploadContacts completed.", new Date().toLocaleString());

    return res.status(200).json({
      success: true,
      data: {
        uploaded: normalizedNumbers.length,
        newlyQueued: newContacts.length,
        alreadyRcsCapableCount,
      },
    });
  } catch (error) {
    console.error("uploadContacts error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};





const checkContactCapability = async (req, res) => {
  try {
    const { campaignId } = req.params;
    console.log("uploadContacts completed successfully.", new Date().toLocaleString());


    if (!campaignId) {
      return res.status(400).json({
        success: false,
        message: "campaignId is required"
      });
    }

    const result = await ContactChecking.aggregate([
      {
        $match: {
          campaignIds: new mongoose.Types.ObjectId(campaignId)
        }
      },
      {
        $group: {
          _id: "$isRcsCapable",
          count: { $sum: 1 }
        }
      }
    ]);

    let rcsCapable = 0;
    let pending = 0;
    let notCapable = 0;

    for (const r of result) {
      if (r._id === true) rcsCapable = r.count;
      else if (r._id === false) notCapable = r.count;
      else pending = r.count;
    }


    console.log("uploadContacts completed successfully.", new Date().toLocaleString());

    return res.status(200).json({
      success: true,
      data: {
        rcsCapable,
        notCapable,
        pending,
        total: rcsCapable + notCapable + pending
      }
    });

  } catch (error) {
    console.error("checkContactCapability error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export { uploadContacts, checkContactCapability };