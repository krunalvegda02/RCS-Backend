// Generate 3000 valid Indian phone numbers
// Run: node generate-contacts.js > contacts.json

const validPrefixes = ['98', '97', '96', '95', '94', '93', '92', '91', '90', '89', '88', '87', '86', '85', '84', '83', '82', '81', '80', '79', '78', '77', '76', '75', '74', '73', '72', '70'];

function generatePhoneNumber() {
  const prefix = validPrefixes[Math.floor(Math.random() * validPrefixes.length)];
  const remaining = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return prefix + remaining;
}

function generateUniqueContacts(count) {
  const contacts = new Set();
  
  while (contacts.size < count) {
    contacts.add(generatePhoneNumber());
  }
  
  return Array.from(contacts);
}

const contacts = generateUniqueContacts(3000);

// Output as JSON array
console.log(JSON.stringify(contacts, null, 2));

// Also output stats
console.error(`Generated ${contacts.length} unique phone numbers`);
console.error(`Sample: ${contacts.slice(0, 5).join(', ')}`);
