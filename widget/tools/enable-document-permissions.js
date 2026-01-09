const fs = require('fs');
const path = require('path');
const settingsPath = path.join(process.env.APPDATA || process.env.HOME || '', 'SADIE', 'config', 'user-settings.json');
if (!fs.existsSync(settingsPath)) {
  console.error('Settings file not found:', settingsPath);
  process.exit(1);
}
const raw = fs.readFileSync(settingsPath, 'utf-8');
let settings = JSON.parse(raw);
settings.permissions = {
  ...settings.permissions,
  parse_document: true,
  get_document_content: true,
  list_documents: true,
  search_document: true
};
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
console.log('Document tool permissions enabled in', settingsPath);