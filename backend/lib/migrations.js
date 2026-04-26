import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '..', 'migrations');

export const listMigrations = () => {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const firstComment = sql.split('\n').find((line) => line.trim().startsWith('--'))?.replace(/^--\s*/, '') || file;
      return {
        id: file.replace(/\.sql$/, ''),
        file,
        description: firstComment,
        statements: (sql.match(/;/g) || []).length
      };
    });
};
