const fs=require('fs'),crypto=require('crypto');
const origin=process.argv[2]||'https://dayin.aidin99mail-ru.workers.dev',file='.runtime/cloudflare-secrets.json';fs.mkdirSync('.runtime',{recursive:true});
const secrets=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
for(const key of ['ADMIN_BOOTSTRAP_PASSWORD','OWNER_BOOTSTRAP_PASSWORD','PASSWORD_PEPPER'])secrets[key]??=crypto.randomBytes(32).toString('base64url');
fs.writeFileSync(file,JSON.stringify(secrets,null,2));fs.writeFileSync('.dev.vars',Object.entries(secrets).map(([k,v])=>k+'='+v).join('\n'));
fs.writeFileSync('.runtime/cloudflare-access.md',`# Доступ к Dayin на Cloudflare\n\nАдминка: ${origin}/admin\nЛогин: admin@dayin.test\nВременный пароль: ${secrets.ADMIN_BOOTSTRAP_PASSWORD}\n\nКабинет ресторана: ${origin}/account\nЛогин: aidos@dayin.test\nВременный пароль: ${secrets.OWNER_BOOTSTRAP_PASSWORD}\n\nПри первом входе задайте новый пароль. Эти пароли отличаются от локальных. После смены использовать нужно новый пароль.\n`);
console.log('Секреты и данные доступа сохранены в .runtime; они исключены из Git.');
