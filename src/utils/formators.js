// ============================================
// utils/formatters.js
// ============================================

export function formatCurrency(amount, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function formatPhoneNumber(phoneNumber) {
  // Format as +91-XXXX-XXXXXX
  if (phoneNumber.length === 10) {
    return `+91-${phoneNumber.slice(0, 4)}-${phoneNumber.slice(4)}`;
  }
  return phoneNumber;
}

export function formatDate(date) {
  return new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export function formatRelativeTime(date) {
  const now = new Date();
  const diffMs = now - new Date(date);
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatDate(date);
}

export function calculateSuccessRate(sent, total) {
  if (total === 0) return 0;
  return ((sent / total) * 100).toFixed(2);
}

export function generateUUID() {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}