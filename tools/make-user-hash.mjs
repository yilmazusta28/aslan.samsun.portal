// Kullanım:  node tools/make-user-hash.mjs "AYKUT DİNLER" rep      (şifreyi sorar, ekranda göstermez)
// Çıktıyı PV_USERS JSON'una ekleyin:  wrangler secret put PV_USERS
import { hashPassword } from '../worker/pv-auth-module.mjs';
import readline from 'node:readline';
const [name, role = 'rep'] = process.argv.slice(2);
if (!name) { console.error('Kullanım: node tools/make-user-hash.mjs "AD SOYAD" [rep|manager|admin]'); process.exit(1); }
const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
rl.question('Şifre (görünür — terminal geçmişine dikkat): ', async (pw) => {
  rl.close();
  if (pw.length < 10) { console.error('En az 10 karakter kullanın.'); process.exit(1); }
  const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  console.log(JSON.stringify({ [name]: { salt, hash: await hashPassword(pw, salt), role } }));
});
