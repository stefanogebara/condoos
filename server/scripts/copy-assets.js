const fs = require('fs');
const path = require('path');

const assets = [
  ['src/db/schema.sql', 'dist/db/schema.sql'],
];

for (const [from, to] of assets) {
  const source = path.resolve(__dirname, '..', from);
  const target = path.resolve(__dirname, '..', to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
