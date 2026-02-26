export const validateTemplateContent = (templateType, content) => {
  if (!content) return false;

  switch (templateType) {
    case 'richCard':
      return content.title && content.imageUrl; // imageUrl stores both image and video URLs
    case 'carousel':
      return Array.isArray(content.cards) && content.cards.length > 0;
    case 'textWithAction':
      return content.text && Array.isArray(content.buttons);
    case 'plainText':
      return content.body;
    default:
      return false;
  }
};