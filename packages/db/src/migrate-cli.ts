import { migrate } from './migrate';

const url = process.env.DATABASE_URL_OWNER;
if (!url) {
  console.error('Defina DATABASE_URL_OWNER (veja .env.example)');
  process.exit(1);
}
const feitas = await migrate(url);
console.log(feitas.length ? `Aplicadas: ${feitas.join(', ')}` : 'Banco já está atualizado');
