
import mongoose from 'mongoose';

const templateSchema = new mongoose.Schema(
  {
    // Basic Info
    name: {
      type: String,
      required: [true, 'Template name is required'],
      trim: true,
      maxlength: [100, 'Template name cannot exceed 100 characters'],
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },

    // Template Type (critical for validation)
    templateType: {
      type: String,
      enum: ['richCard', 'carousel', 'textWithAction', 'plainText'],
      required: [true, 'Template type is required'],
      index: true,
    },

    // Owner & Access Control
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Template Content (flexible structure based on type)
    content: {
      // For Rich Card
      title: String,
      subtitle: String,
      description: String,
      imageUrl: String,
      mediaType: {
        type: String,
        enum: ['image', 'video'],
        default: 'image',
      },
      thumbnailUrl: String,
      actions: [
        {
          label: String,
          uri: String,
          actionType: {
            type: String,
            enum: ['openUri', 'postback', 'dialPhone'],
          },
        },
      ],

      // For Carousel
      cards: [
        {
          title: String,
          subtitle: String,
          description: String,
          imageUrl: String,
          mediaType: {
            type: String,
            enum: ['image', 'video'],
            default: 'image',
          },
          thumbnailUrl: String,
          actions: [
            {
              label: String,
              uri: String,
              actionType: String,
            },
          ],
        },
      ],

      // For Text with Action
      text: String,
      buttons: [
        {
          label: String,
          value: String,
          actionType: String,
        },
      ],

      // For Plain Text
      body: String,
    },

    // Validation & Status
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    approvedAt: Date,
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // Usage Statistics
    usageCount: {
      type: Number,
      default: 0,
    },
    successRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    totalMessagesSent: {
      type: Number,
      default: 0,
    },


    // Audit Trail
    lastUsedAt: Date,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    collection: 'templates',
  }
);

// Indexes for performance
templateSchema.index({ userId: 1, isActive: 1 });
templateSchema.index({ templateType: 1, isApproved: 1 });
templateSchema.index({ createdAt: -1 });

// Pre-save validation
templateSchema.pre('save', function (next) {
  // Validate content based on templateType
  this.validateContentStructure();
  next();
});

// Instance method to validate content
templateSchema.methods.validateContentStructure = function () {
  const { templateType, content } = this;

  if (!content) throw new Error('Content is required');

  switch (templateType) {
    case 'richCard':
      if (!content.title) throw new Error('Rich card requires title');
      if (!content.imageUrl) throw new Error('Rich card requires media URL');
      break;

    case 'carousel':
      if (!Array.isArray(content.cards) || content.cards.length === 0) {
        throw new Error('Carousel requires at least one card');
      }
      if (content.cards.length > 10) {
        throw new Error('Carousel cannot have more than 10 cards');
      }
      break;

    case 'textWithAction':
      if (!content.text) throw new Error('Text with action requires text');
      if (!Array.isArray(content.buttons) || content.buttons.length === 0) {
        throw new Error('Text with action requires at least one button');
      }
      if (content.buttons.length > 4) {
        throw new Error('Maximum 4 buttons allowed');
      }
      break;

    case 'plainText':
      if (!content.body) throw new Error('Plain text requires body');
      if (content.body.length > 1000) {
        throw new Error('Plain text cannot exceed 1000 characters');
      }
      break;
  }
};

// Static method to get template with validation
templateSchema.statics.getValidTemplate = async function (templateId, userId) {
  const template = await this.findOne({
    _id: templateId,
    userId: userId,
    isActive: true,
  });

  if (!template) {
    throw new Error('Template not found or inactive');
  }

  return template;
};

// Method to increment usage
templateSchema.methods.incrementUsage = async function () {
  this.usageCount += 1;
  this.lastUsedAt = new Date();
  await this.save();
};

// Method to generate RCS payload
// templateSchema.methods.generatePayload = function () {
//   const { templateType, content } = this;
//   let jioContent;

//   switch (templateType) {
//     case 'richCard': {
//       const cardContent = {};

//       if (content.title?.trim()) {
//         cardContent.cardTitle = content.title.trim();
//       }

//       if ((content.description || content.subtitle)?.trim()) {
//         cardContent.cardDescription = (content.description || content.subtitle).trim();
//       }

//       if (content.imageUrl?.trim()) {
//         cardContent.cardMedia = {
//           mediaHeight: 'TALL',
//           contentInfo: { fileUrl: content.imageUrl.trim() }
//         };
//       }

//       if (content.actions?.length > 0) {
//         cardContent.suggestions = content.actions
//           .filter(action => action.label && action.uri)
//           .map(action => {
//             const label = action.label;
//             const uri = action.uri;

//             if (action.actionType === 'openUri' || uri.startsWith('http')) {
//               return {
//                 action: {
//                   plainText: label,
//                   postBack: { data: uri },
//                   openUrl: { url: uri.startsWith('http') ? uri : `https://${uri}` }
//                 }
//               };
//             }

//             if (action.actionType === 'dialPhone' || uri.startsWith('+')) {
//               return {
//                 action: {
//                   plainText: label,
//                   postBack: { data: uri },
//                   dialerAction: { phoneNumber: uri.startsWith('+') ? uri : `+91${uri}` }
//                 }
//               };
//             }

//             return {
//               reply: {
//                 plainText: label,
//                 postBack: { data: uri }
//               }
//             };
//           });
//       }

//       jioContent = {
//         richCardDetails: {
//           standalone: {
//             cardOrientation: 'VERTICAL',
//             content: cardContent
//           }
//         }
//       };
//       break;
//     }

//     case 'carousel': {
//       const validCards = (content.cards || []).map(card => {
//         if (!card.title?.trim() || !(card.description || card.subtitle)?.trim() || !card.imageUrl?.trim()) {
//           return null;
//         }

//         const cardContent = {
//           cardTitle: card.title.trim(),
//           cardDescription: (card.description || card.subtitle).trim(),
//           cardMedia: {
//             contentInfo: { fileUrl: card.imageUrl.trim() },
//             mediaHeight: 'MEDIUM'
//           }
//         };

//         if (card.actions?.length > 0) {
//           cardContent.suggestions = card.actions
//             .filter(action => action.label && action.uri)
//             .map(action => {
//               if (action.actionType === 'openUri') {
//                 return {
//                   action: {
//                     plainText: action.label,
//                     postBack: { data: 'carousel_action' },
//                     openUrl: { url: action.uri }
//                   }
//                 };
//               }
//               if (action.actionType === 'dialPhone') {
//                 return {
//                   action: {
//                     plainText: action.label,
//                     postBack: { data: 'carousel_action' },
//                     dialerAction: { phoneNumber: action.uri.startsWith('+') ? action.uri : `+91${action.uri}` }
//                   }
//                 };
//               }
//               return {
//                 reply: {
//                   plainText: action.label,
//                   postBack: { data: action.uri }
//                 }
//               };
//             });
//         }

//         return cardContent;
//       }).filter(Boolean);

//       jioContent = {
//         richCardDetails: {
//           carousel: {
//             cardWidth: 'MEDIUM_WIDTH',
//             contents: validCards
//           }
//         }
//       };
//       break;
//     }

//     case 'textWithAction': {
//       const textSuggestions = (content.buttons || []).map(btn => {
//         const label = btn.label || btn.text || 'Action';
//         const value = btn.value || btn.uri || '';

//         if (!label || !value) return null;

//         if (btn.actionType === 'dialPhone') {
//           return {
//             action: {
//               plainText: label,
//               postBack: { data: value },
//               dialerAction: { phoneNumber: value.startsWith('+') ? value : `+91${value}` }
//             }
//           };
//         }

//         if (btn.actionType === 'openUri') {
//           return {
//             action: {
//               plainText: label,
//               postBack: { data: value },
//               openUrl: { url: value.startsWith('http') ? value : `https://${value}` }
//             }
//           };
//         }

//         return {
//           reply: {
//             plainText: label,
//             postBack: { data: value }
//           }
//         };
//       }).filter(Boolean);

//       jioContent = {
//         plainText: content.text,
//         ...(textSuggestions.length > 0 ? { suggestions: textSuggestions } : {})
//       };
//       break;
//     }

//     case 'plainText':
//       jioContent = { plainText: content.body };
//       break;

//     default:
//       throw new Error(`Unsupported template type: ${templateType}`);
//   }

//   return { content: jioContent };
// };

templateSchema.methods.generatePayload = function () {
  const { templateType, content } = this;

  if (!content) {
    throw new Error('Template content is required');
  }

  // =========================
  // Helpers (Jio-safe)
  // =========================
  const toBase64 = (val) =>
    Buffer.from(String(val), 'utf8').toString('base64');

  const sanitizeLabel = (label) =>
    String(label).trim().slice(0, 25); // Jio max 25 chars

  const sanitizePhoneNumber = (phone) => {
    if (!phone) return phone;
    // Convert to string and remove all whitespace and special characters except digits and +
    let cleaned = String(phone).trim().replace(/[^\d+]/g, '');
    // Remove any + signs that aren't at the start
    cleaned = cleaned.replace(/(?!^)\+/g, '');
    // If it starts with +, keep it; otherwise add +91
    if (!cleaned.startsWith('+')) {
      // Remove leading zeros
      cleaned = cleaned.replace(/^0+/, '');
      cleaned = '+91' + cleaned;
    }
    // E.164 format: max 15 chars total (including +)
    return cleaned.slice(0, 15);
  };

  const ensureHttps = (url) => {
    if (!url) return url;
    // Force https and handle protocol-less URLs
    let formatted = url.startsWith('//') ? `https:${url}` : url;
    if (!formatted.startsWith('http')) formatted = `https://${formatted}`;
    return formatted.replace(/^http:/, 'https:');
  };

  // =========================
  // Suggestion Builder
  // =========================
  const buildSuggestion = (action = {}) => {
    const label = sanitizeLabel(action.label);
    const value = action.uri || action.value;

    if (!label || !value) return null;

    // SuggestedAction → openUrl
    if (action.actionType === 'openUri') {
      return {
        action: {
          plainText: label,
          postback: { data: toBase64(value) },
          openUrl: {
            url: ensureHttps(value),
          },
        },
      };
    }

    // SuggestedAction → dialerAction
    if (action.actionType === 'dialPhone') {
      return {
        action: {
          plainText: label,
          postback: { data: toBase64(value) },
          dialerAction: {
            phoneNumber: sanitizePhoneNumber(value),
          },
        },
      };
    }

    // SuggestedReply (⚠️ plaintext, NOT plainText)
    return {
      reply: {
        plaintext: label,
        postback: { data: toBase64(value) },
      },
    };
  };

  let jioContent;

  // =========================
  // Template Types
  // =========================
  switch (templateType) {
    // -------- Rich Card --------
    case 'richCard': {
      if (!content.title || !content.imageUrl) {
        throw new Error('Rich card requires title and imageUrl');
      }

      // Build contentInfo based on media type
      const richCardContentInfo = {
        fileUrl: ensureHttps(content.imageUrl),
      };
      // If video and thumbnailUrl exists, add it
      if (content.mediaType === 'video' && content.thumbnailUrl) {
        richCardContentInfo.thumbnailUrl = ensureHttps(content.thumbnailUrl);
      }

      const cardContent = {
        cardTitle: content.title.trim().slice(0, 200),
        ...(content.description || content.subtitle
          ? {
            cardDescription: (content.description || content.subtitle).trim().slice(0, 2000),
          }
          : {}),
        cardMedia: {
          mediaHeight: 'MEDIUM',
          contentInfo: richCardContentInfo,
        },
      };

      if (Array.isArray(content.actions) && content.actions.length) {
        cardContent.suggestions = content.actions
          .map(buildSuggestion)
          .filter(Boolean)
          .slice(0, 4);
      }

      jioContent = {
        richCardDetails: {
          standalone: {
            cardOrientation: 'VERTICAL',
            content: cardContent,
          },
        },
      };
      break;
    }

    // -------- Carousel --------
    case 'carousel': {
      if (!Array.isArray(content.cards) || content.cards.length === 0) {
        throw new Error('Carousel requires at least one card');
      }

      const cards = content.cards
        .map((card) => {
          if (!card.title || !card.imageUrl) return null;

          // Build contentInfo based on media type
          const carouselContentInfo = {
            fileUrl: ensureHttps(card.imageUrl),
          };
          // If video and thumbnailUrl exists, add it
          if (card.mediaType === 'video' && card.thumbnailUrl) {
            carouselContentInfo.thumbnailUrl = ensureHttps(card.thumbnailUrl);
          }

          const c = {
            cardTitle: card.title.trim().slice(0, 200),
            ...(card.description || card.subtitle
              ? {
                cardDescription: (card.description || card.subtitle).trim().slice(0, 2000),
              }
              : {}),
            cardMedia: {
              mediaHeight: 'MEDIUM',
              contentInfo: carouselContentInfo,
            },
          };

          if (Array.isArray(card.actions) && card.actions.length) {
            c.suggestions = card.actions
              .map(buildSuggestion)
              .filter(Boolean)
              .slice(0, 4);
          }

          return c;
        })
        .filter(Boolean)
        .slice(0, 10); // Jio max 10 cards

      if (!cards.length) {
        throw new Error('Carousel has no valid cards');
      }

      jioContent = {
        richCardDetails: {
          carousel: {
            cardWidth: 'MEDIUM_WIDTH',
            contents: cards,
          },
        },
      };
      break;
    }

    // -------- Text with Action --------
    case 'textWithAction': {
      if (!content.text) {
        throw new Error('TextWithAction requires text');
      }

      const suggestions = (content.buttons || [])
        .map(buildSuggestion)
        .filter(Boolean)
        .slice(0, 4);

      jioContent = {
        plainText: content.text,
        ...(suggestions.length ? { suggestions } : {}),
      };
      break;
    }

    // -------- Plain Text --------
    case 'plainText': {
      if (!content.body) {
        throw new Error('PlainText requires body');
      }

      jioContent = {
        plainText: content.body,
      };
      break;
    }

    default:
      throw new Error(`Unsupported template type: ${templateType}`);
  }

  // =========================
  // Final payload
  // =========================
  return {
    content: jioContent,
  };
};




export default mongoose.model('Template', templateSchema);