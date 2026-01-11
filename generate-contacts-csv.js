// Generate 3000 valid Indian phone numbers as CSV
// Run: node generate-contacts-csv.js > contacts.csv

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

// Output as CSV (one number per line)
contacts.forEach(phone => console.log(phone));

console.error(`\nGenerated ${contacts.length} unique phone numbers`);
console.error(`Saved to contacts.csv`);
console.error(`\nTo use: Copy and paste into frontend contact upload`);
