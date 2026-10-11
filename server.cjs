const {DISH_CATEGORIES,dishCategory}=require('./dish-categories.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const { customerAuth } = require('./future/customer-auth.cjs');
const { RETENTION_MS, purgeDueRestaurants } = require('./restaurant-lifecycle.cjs');
const { transaction } = require('./sqlite-transaction.cjs');
const { catalogPage } = require('./catalog.cjs');
const {createRecord}=require('./order-record.cjs');
const scrypt = promisify(crypto.scrypt);
const CUISINES = ['Европейская','Итальянская','Азиатская','Казахская','Грузинская','Узбекская','Турецкая','Японская','Корейская','Китайская','Индийская','Кофейни'];
const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (v, name, max = 200) => { if (typeof v !== 'string' || !v.trim() || v.trim().length > max) fail(400, `Проверьте поле «${name}»`); return v.trim(); };
const email = v => { const x = text(v, 'Почта', 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) fail(400, 'Укажите корректную почту'); return x; };
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
async function scryptPasswordHash(password) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + (await scrypt(password, salt, 64)).toString('hex'); }
async function scryptPasswordMatches(password, hash) { const [salt, digest] = hash.split(':'); const actual = await scrypt(password, salt, 64); return crypto.timingSafeEqual(actual, Buffer.from(digest, 'hex')); }

async function createApp(options = {}) {
  const config = options.env || process.env;
  const passwordHash=options.passwordHash||scryptPasswordHash,passwordMatches=options.passwordMatches||scryptPasswordMatches;
  const lifecycleNow = options.lifecycleNow || Date.now;
  const localMail = options.localMail ?? process.env.MAIL_MODE === 'local';
  const port = options.port ?? Number(process.env.PORT || 4173);
  const origin = options.origin || process.env.APP_URL || `http://127.0.0.1:${port}`;
  const runtime = options.db ? null : (options.dataDir || process.env.DATA_DIR || path.join(__dirname, '.runtime'));
  if (!options.db) fs.mkdirSync(runtime, { recursive: true });
  if (localMail && !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Локальная почта разрешена только на loopback');
  if (!localMail && !origin.startsWith('https://') && !(options.bootstrap && ['127.0.0.1','localhost'].includes(new URL(origin).hostname))) throw new Error('Для почтового режима нужен HTTPS APP_URL');
  const db = options.db || new DatabaseSync(path.join(runtime, 'dayin.sqlite'));
  if (!options.db) db.exec('PRAGMA journal_mode=WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS menus (restaurant TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, restaurant TEXT, role TEXT NOT NULL, hash TEXT NOT NULL, must_change INTEGER NOT NULL, temp_expires INTEGER, delivery TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, restaurant TEXT NOT NULL, guest TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mailbox (id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  if (!db.prepare('PRAGMA table_info(records)').all().some(column => column.name === 'customer')) db.exec('ALTER TABLE records ADD COLUMN customer TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS records_customer ON records(customer); CREATE INDEX IF NOT EXISTS records_guest ON records(guest)');
  db.exec("CREATE INDEX IF NOT EXISTS records_kind_restaurant ON records(kind,restaurant); CREATE INDEX IF NOT EXISTS restaurants_status ON restaurants(json_extract(payload,'$.status')); CREATE INDEX IF NOT EXISTS restaurants_delete_at ON restaurants(json_extract(payload,'$.deleteAt'))");
  db.prepare("DELETE FROM sessions WHERE user IN (SELECT id FROM users WHERE role='customer')").run();
  const allRestaurants = () => db.prepare('SELECT payload FROM restaurants ORDER BY rowid').all().map(x => JSON.parse(x.payload));
  const getMenu = id => JSON.parse(db.prepare('SELECT payload FROM menus WHERE restaurant=?').get(id)?.payload || '[]').map(d=>({...d,category:dishCategory(d)}));
  const getRestaurant = id => { const row = db.prepare('SELECT payload FROM restaurants WHERE id=?').get(id); if (!row) fail(404, 'Заведение не найдено'); return JSON.parse(row.payload); };
  const putRestaurant = r => { r.maxGuests ??= 8; r.halal ??= null; r.cuisines ??= [r.type || 'Европейская']; r.status ??= 'active'; r.deleteAt ??= null; r.city ??= 'Атырау'; return db.prepare('INSERT OR REPLACE INTO restaurants VALUES (?,?)').run(r.id, JSON.stringify(r)); };
  const available = r => r.status === 'active' && !r.deleteAt;
  const putMenu = (id, items) => db.prepare('INSERT OR REPLACE INTO menus VALUES (?,?)').run(id, JSON.stringify(items));
  const credentials = (user, temporary) => `Здравствуйте, ${user.name}!\n\nВаша учётная запись Dayin зарегистрирована.\nЛогин: ${user.email}\nВременный пароль: ${temporary}\nЛичный кабинет: ${origin}${user.role === 'admin' ? '/admin' : '/account'}\n\nПри первом входе обязательно задайте новый пароль и повторите его. До смены пароля кабинет недоступен. Временный пароль действует 24 часа.\n\nDayin`;
  async function deliver(user, temporary) {
    const subject = 'Dayin — доступ к личному кабинету';
    const body = credentials(user, temporary);
    if (localMail) {
      db.prepare('INSERT INTO mailbox VALUES (?,?,?,?,?)').run(crypto.randomUUID(), user.email, subject, body, Date.now());
      return 'local';
    }
    if (!config.RESEND_API_KEY || !config.MAIL_FROM) fail(503, 'Отправка писем не настроена. Обратитесь к администратору.');
    let response;
    try { response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `registration-${user.id}-${hashToken(temporary)}` },
      body: JSON.stringify({ from: config.MAIL_FROM, to: [user.email], subject, text: body, html: `<div style="font:16px/1.7 Arial;color:#252b26"><h1>Добро пожаловать в Dayin</h1><p>${escape(body).replace(/\n/g, '<br>')}</p></div>` }), signal: AbortSignal.timeout(15000)
    }); } catch { fail(503, 'Почтовый сервис недоступен. Повторите попытку позже.'); }
    if (!response.ok) fail(503, 'Письмо не принято почтовым сервисом. Обратитесь к администратору.');
    return 'accepted';
  }
  const pendingEmails = new Set();
  async function registerUser(fields) {
    if (fields.role === 'customer') fail(404, 'Не найдено');
    const address = email(fields.email), name = text(fields.name, 'ФИО', 120);
    if (fields.role !== 'customer' && name.split(/\s+/).length < 2) fail(400, 'Укажите фамилию и имя');
    if (pendingEmails.has(address) || db.prepare('SELECT id FROM users WHERE email=?').get(address)) fail(409, 'Учётная запись с этой почтой уже зарегистрирована');
    pendingEmails.add(address);
    const user = { id: crypto.randomUUID(), email: address, name, restaurant: fields.restaurant || null, role: fields.role || 'owner' };
    const temporary = crypto.randomBytes(18).toString('base64url');
    try {
      const hash = await passwordHash(temporary);
      db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)').run(user.id, user.email, user.name, user.restaurant, user.role, hash, 1, Date.now() + 86400000, 'pending', 0);
      try {
        const delivery = await deliver(user, temporary);
        db.prepare('UPDATE users SET delivery=?,active=1 WHERE id=?').run(delivery, user.id);
        return { ...user, delivery };
      } catch (e) { db.prepare('DELETE FROM users WHERE id=?').run(user.id); throw e; }
    } finally { pendingEmails.delete(address); }
  }
  // The sole starter is a registered local account, not an invented real owner.
  if (!db.prepare("SELECT value FROM settings WHERE key='initialized'").get()) {
    const r = { id: 'r1', name: 'Зелёный двор', type: 'Европейская', desc: 'Сезонная кухня · Уютный дворик', address: 'Атырау · адрес уточняется', rating: '—', time: '25–35', avg: 6500, img: 'photo-1414235077428-338989a2e8c0', tag: 'Зарегистрированное заведение', registered: true };
    putRestaurant(r);
    putMenu('r1', [
      { id: 'd1', name: 'Салат с burrata', desc: 'Томаты, буррата, базилик · 240 г', price: 3900, img: 'photo-1515543904379-3d757afe72e4' },
      { id: 'd2', name: 'Паста с грибами', desc: 'Лесные грибы, сливочный соус, пармезан · 320 г', price: 4200, img: 'photo-1473093295043-cdd812d0e601' },
      { id: 'd3', name: 'Лосось на гриле', desc: 'Сезонные овощи, лимонный соус · 280 г', price: 6500, img: 'photo-1467003909585-2f8a72700288' },
      { id: 'd4', name: 'Тирамису', desc: 'Маскарпоне, эспрессо, какао · 150 г', price: 2400, img: 'photo-1571877227200-a0d98ea607e9' }
    ]);
    if (options.bootstrap) {
      for(const [role,restaurant,address,name,temporary] of [['admin',null,'admin@dayin.test','Администратор платформы',options.bootstrap.admin],['owner','r1','aidos@dayin.test','Сәрсенов Айдос Нұрланұлы',options.bootstrap.owner]]){
        if(typeof temporary!=='string'||temporary.length<12)throw Error('Задайте секреты первоначального доступа');
        const hash=await passwordHash(temporary);
        db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),address,name,restaurant,role,hash,1,Date.now()+86400000,'bootstrap',1);
      }
    } else if (localMail) {
      await registerUser({ email: 'aidos@dayin.test', name: 'Сәрсенов Айдос Нұрланұлы', restaurant: 'r1' });
      await registerUser({ email: 'admin@dayin.test', name: 'Администратор платформы', role: 'admin' });
    } else {
      if (!process.env.OWNER_EMAIL || !process.env.OWNER_NAME || !process.env.ADMIN_EMAIL || !process.env.ADMIN_NAME) throw new Error('Укажите OWNER_EMAIL, OWNER_NAME, ADMIN_EMAIL, ADMIN_NAME до первого запуска');
      await registerUser({ email: process.env.OWNER_EMAIL, name: process.env.OWNER_NAME, restaurant: 'r1' });
      await registerUser({ email: process.env.ADMIN_EMAIL, name: process.env.ADMIN_NAME, role: 'admin' });
    }
    db.prepare("INSERT INTO settings VALUES ('initialized','1')").run();
  }
  // Existing restaurants retain the previous booking limit until their owner changes it.
  for (const r of allRestaurants()) if (r.maxGuests === undefined || r.halal === undefined || r.cuisines === undefined || r.status === undefined || r.deleteAt === undefined || r.city === undefined) { if(r.id==='r1'&&r.address==='ул. Панфилова, 114')r.address='Атырау · адрес уточняется'; putRestaurant(r); }
  const purge = () => purgeDueRestaurants(db, lifecycleNow());
  purge();
  const attempts = new Map();
  function limit(key, max = 12) {
    const now = Date.now(), old = attempts.get(key);
    const entry = old && old.until > now ? old : { count: 0, until: now + 600000 };
    attempts.set(key, entry);
    if (++entry.count > max) fail(429, 'Слишком много попыток. Попробуйте через 10 минут.');
    if (attempts.size > 5000) for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  }
  function cookie(req, key) { const value = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(key + '=')); return value?.slice(key.length + 1); }
  function setCookie(res, name, token, maxAge) {
    const value = `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`;
    const existing = res.getHeader('Set-Cookie') || []; res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), value]);
  }
  function session(req) {
    const token = cookie(req, 'dayin_session'); if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db.prepare("SELECT users.*, sessions.token AS session_token FROM sessions JOIN users ON users.id=sessions.user WHERE sessions.token=? AND sessions.expires>? AND users.active=1 AND users.role<>'customer'").get(hashToken(token), Date.now()) || null;
  }
  function authenticated(req, role) {
    const u = session(req); if (!u) fail(401, 'Войдите в личный кабинет');
    if (u.must_change) fail(403, 'Сначала задайте новый пароль');
    if (role && u.role !== role) fail(403, 'Недостаточно прав'); return u;
  }
  function owns(u, id) { if (u.role !== 'admin' && (u.role !== 'owner' || u.restaurant !== id)) fail(403, 'Нет доступа к этому заведению'); }
  function publicUser(u) { return u ? { id: u.id, email: u.email, name: u.name, restaurant: u.restaurant, role: u.role, mustChangePassword: !!u.must_change } : null; }
  function guest(req, res) {
    let token = cookie(req, 'dayin_guest');
    if (!token || !/^[a-f0-9]{64}$/.test(token)) { token = crypto.randomBytes(32).toString('hex'); setCookie(res, 'dayin_guest', token, 31536000); }
    return hashToken(token);
  }
  function rotateGuest(res) { setCookie(res, 'dayin_guest', crypto.randomBytes(32).toString('hex'), 31536000); }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Нужен JSON');
    let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 20000) fail(413, 'Слишком большой запрос'); }
    try { return JSON.parse(data); } catch { fail(400, 'Некорректный запрос'); }
  }
  function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  function records(kind, where, key) { return db.prepare(`SELECT payload FROM records WHERE kind=? AND ${where}=?${where === 'guest' ? ' AND customer IS NULL' : ''} ORDER BY rowid DESC LIMIT 100`).all(kind, key).map(x => JSON.parse(x.payload)); }
  const server = (options.createServer || http.createServer)(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://images.unsplash.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      if (req.headers.host !== new URL(origin).host) fail(403, 'Недопустимый адрес сервера');
      const url = new URL(req.url, origin), p = url.pathname;
      if (p.startsWith('/api/customer/') || ['/profile','/login','/signup'].includes(p)) fail(404, 'Не найдено');
      if (!['GET', 'HEAD', 'POST', 'PATCH'].includes(req.method)) fail(405, 'Метод не поддерживается');
      if (['POST', 'PATCH'].includes(req.method)) {
        if (req.headers.origin !== origin) fail(403, 'Недопустимый источник запроса');
        if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Недопустимый источник запроса');
      }
      if (p === '/dev/mail' || p === '/api/dev/mail') {
        if (!localMail || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) fail(404, 'Не найдено');
        if (req.method !== 'GET') fail(405, 'Метод не поддерживается');
        const messages = db.prepare("SELECT * FROM mailbox WHERE recipient NOT IN (SELECT email FROM users WHERE role='customer') ORDER BY created DESC").all();
        if (p === '/api/dev/mail') return json(res, 200, { messages });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Локальная почта Dayin</title><link rel="stylesheet" href="/style.css"><main style="max-width:850px;margin:auto;padding:30px"><a href="/">← Dayin</a><h1>Локальная почта</h1><p>Письма для проверки на этом компьютере. На настоящую почту они не отправлены.</p>${messages.map(m => `<article class="panel" style="margin:20px 0"><strong>${escape(m.recipient)}</strong><h2>${escape(m.subject)}</h2><p style="white-space:pre-wrap;color:#252b26">${escape(m.body).replace(escape(origin + '/account'), `<a class="quiet" href="/account">${escape(origin + '/account')}</a>`).replace(escape(origin + '/admin'), `<a class="quiet" href="/admin">${escape(origin + '/admin')}</a>`)}</p></article>`).join('')}</main></html>`); return;
      }
      purge();
      if (p === '/api/catalog' && req.method === 'GET') {
        const u = url.searchParams.get('manage') === '1' ? authenticated(req) : null;
        const result=catalogPage(db,url.searchParams,u);
        if(u?.role==='owner')result.menus={[u.restaurant]:getMenu(u.restaurant)};
        return json(res, 200, result);
      }
      const publicMenu=p.match(/^\/api\/restaurants\/([^/]+)\/menu$/);
      if(publicMenu&&req.method==='GET'){
        const r=getRestaurant(publicMenu[1]),u=session(req);if(!available(r)&&!(u&&!u.must_change&&(u.role==='admin'||u.restaurant===r.id)))fail(404,'Заведение временно недоступно');
        return json(res,200,{restaurant:r,menu:getMenu(r.id)});
      }
      const qrMatch = p.match(/^\/api\/restaurants\/([^/]+)\/qr$/);
      if (qrMatch && req.method === 'GET') {
        const u = authenticated(req), id = qrMatch[1]; owns(u, id); getRestaurant(id);
        const menuUrl = `${origin}/menu/${encodeURIComponent(id)}`;
        const format = url.searchParams.get('format');
        if (!format) return json(res, 200, { menuUrl });
        if (!['svg', 'png'].includes(format)) fail(400, 'Выберите SVG или PNG');
        const size = Number(url.searchParams.get('size') || 1024);
        if (![512, 1024, 2048].includes(size)) fail(400, 'Недопустимый размер QR-кода');
        limit('qr:' + u.id, 100);
        const QRCode = require('qrcode/lib/server');
        const options = { errorCorrectionLevel: 'Q', margin: 4, width: size, color: { dark: '#000000ff', light: '#ffffffff' } };
        const data = format === 'svg' ? await QRCode.toString(menuUrl, { ...options, type: 'svg' }) : await QRCode.toBuffer(menuUrl, { ...options, type: 'png' });
        res.writeHead(200, { 'Content-Type': format === 'svg' ? 'image/svg+xml; charset=utf-8' : 'image/png', 'Cache-Control': 'no-store', 'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="dayin-menu-${id}.${format}"` });
        res.end(data); return;
      }
      if (p === '/api/auth/session' && req.method === 'GET') return json(res, 200, { user: publicUser(session(req)), localMail, customerAuth });
      if (p === '/api/auth/register' && req.method === 'POST') {
        limit('register:' + req.socket.remoteAddress, 6); const f = await body(req);
        const restaurantName = text(f.restaurantName, 'Название заведения', 80);
        const rid = crypto.randomUUID();
        const u = await registerUser({ email: f.email, name: f.name, restaurant: rid });
        putRestaurant({ id: rid, name: restaurantName, type: 'Европейская', desc: 'Меню скоро появится', address: 'Адрес уточняется', rating: '—', time: '30–45', avg: 0, img: 'photo-1414235077428-338989a2e8c0', tag: 'Зарегистрированное заведение', registered: true });
        putMenu(rid, []);
        return json(res, 201, { delivery: u.delivery });
      }
      if (p === '/api/auth/login' && req.method === 'POST') {
        limit('login:' + req.socket.remoteAddress, 30); const f = await body(req); const address = email(f.email);
        if (f.audience === 'customer') fail(404, 'Не найдено');
        limit('login-email:' + address, 10);
        const password = text(f.password, 'Пароль', 128);
        const u = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(address);
        if (u?.role === 'customer') fail(404, 'Не найдено');
        const valid = u ? await passwordMatches(password, u.hash) : await passwordMatches(password, '00000000000000000000000000000000:' + '00'.repeat(64));
        if (!u || !valid) fail(401, 'Неверный логин или пароль');
        if ((f.audience === 'customer' && u.role !== 'customer') || (f.audience === 'business' && u.role === 'customer')) fail(403, 'Используйте вход для вашей учётной записи');
        const latest = db.prepare('SELECT hash FROM users WHERE id=? AND active=1').get(u.id);
        if (!latest || latest.hash !== u.hash) fail(401, 'Пароль изменён. Войдите снова.');
        if (u.must_change && u.temp_expires < Date.now()) fail(401, 'Временный пароль истёк. Обратитесь к администратору.');
        const token = crypto.randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hashToken(token), u.id, Date.now() + (u.must_change ? 1800000 : 28800000));
        setCookie(res, 'dayin_session', token, u.must_change ? 1800 : 28800);
        return json(res, 200, { user: publicUser(u) });
      }
      if (p === '/api/auth/password' && req.method === 'POST') {
        const u = session(req); if (!u) fail(401, 'Войдите в личный кабинет');
        if (!u.must_change) fail(400, 'Первичная смена пароля уже выполнена');
        limit('password:' + u.id, 10); const f = await body(req);
        if (typeof f.password !== 'string' || f.password.length < 12 || f.password.length > 128) fail(400, 'Пароль должен содержать от 12 до 128 символов');
        if (f.password !== f.confirmPassword) fail(400, 'Пароли не совпадают');
        if (await passwordMatches(f.password, u.hash)) fail(400, 'Новый пароль должен отличаться от временного');
        const newHash = await passwordHash(f.password), token = crypto.randomBytes(32).toString('hex');
        transaction(db,()=>{
          const changed = db.prepare('UPDATE users SET hash=?,must_change=0,temp_expires=NULL WHERE id=? AND hash=? AND must_change=1').run(newHash, u.id, u.hash);
          if (!changed.changes) fail(409, 'Пароль уже изменён. Войдите снова.');
          db.prepare('DELETE FROM sessions WHERE user=?').run(u.id);
          db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hashToken(token), u.id, Date.now() + 28800000);
        });
        setCookie(res, 'dayin_session', token, 28800);
        return json(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
      }
      if (p === '/api/auth/logout' && req.method === 'POST') { const token = cookie(req, 'dayin_session'); if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(token)); setCookie(res, 'dayin_session', '', 0); rotateGuest(res); return json(res, 200, { ok: true }); }
      if (p === '/api/account' && req.method === 'GET') {
        const u = authenticated(req), id = u.restaurant;
        if (!['owner', 'admin'].includes(u.role)) fail(403, 'Нет доступа к кабинету ресторана');
        return json(res, 200, { user: publicUser(u), stats:{restaurants:db.prepare('SELECT COUNT(*) AS n FROM restaurants').get().n,orders:db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='orders'").get().n,bookings:db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='bookings'").get().n}, restaurants: u.role === 'admin' ? catalogPage(db,url.searchParams,u).restaurants : [getRestaurant(id)], orders: u.role === 'admin' ? db.prepare("SELECT payload FROM records WHERE kind='orders' ORDER BY rowid DESC LIMIT 100").all().map(x => JSON.parse(x.payload)) : records('orders', 'restaurant', id), bookings: u.role === 'admin' ? db.prepare("SELECT payload FROM records WHERE kind='bookings' ORDER BY rowid DESC LIMIT 100").all().map(x => JSON.parse(x.payload)) : records('bookings', 'restaurant', id), owners: u.role === 'admin' ? db.prepare("SELECT email,name,restaurant,delivery FROM users WHERE role='owner'").all() : [] });
      }
      if (p === '/api/my' && req.method === 'GET') { const id = guest(req, res), where = 'guest'; return json(res, 200, { orders: records('orders', where, id), bookings: records('bookings', where, id) }); }
      if ((p === '/api/orders' || p === '/api/bookings') && req.method === 'POST') {
        limit('record:' + req.socket.remoteAddress, 60); const f = await body(req); const venue = getRestaurant(f.restaurant);
        if (!available(venue)) fail(409, 'Заведение временно не принимает заказы и бронирования');
        const kind = p === '/api/orders' ? 'orders' : 'bookings', id = crypto.randomUUID();
        const record = createRecord(kind,f,venue,getMenu(f.restaurant),id);
        const customer = null;
        db.prepare('INSERT INTO records (id,kind,restaurant,guest,payload,customer) VALUES (?,?,?,?,?,?)').run(id, kind, f.restaurant, guest(req, res), JSON.stringify(record), customer); return json(res, 201, { record });
      }
      const recordMatch = p.match(/^\/api\/(orders|bookings)\/([^/]+)$/);
      if (recordMatch && req.method === 'PATCH') {
        const [_, kind, id] = recordMatch, f = await body(req), row = db.prepare('SELECT * FROM records WHERE id=? AND kind=?').get(id, kind); if (!row) fail(404, 'Заявка не найдена');
        const record = JSON.parse(row.payload);
        if (f.cancel) { if (row.customer) { const u = authenticated(req, 'customer'); if (u.id !== row.customer) fail(403, 'Нет доступа к этой заявке'); } else if (row.guest !== guest(req, res)) fail(403, 'Нет доступа к этой заявке'); if (['Завершён','Отменён','Отменено','Гости пришли'].includes(record.status)) fail(409, 'Заявка уже завершена'); record.status = kind === 'orders' ? 'Отменён' : 'Отменено'; }
        else { const u = authenticated(req); owns(u, row.restaurant); const statuses = kind === 'orders' ? ['Новый','Принят','Готовится','Готов к выдаче','В пути','Завершён','Отменён'] : ['Ожидает подтверждения','Подтверждено','Гости пришли','Отменено']; if (!statuses.includes(f.status) || (record.mode === 'Самовывоз' && f.status === 'В пути')) fail(400, 'Некорректный статус'); record.status = f.status; }
        db.prepare('UPDATE records SET payload=? WHERE id=?').run(JSON.stringify(record), id); return json(res, 200, { record });
      }
      const menuMatch = p.match(/^\/api\/restaurants\/([^/]+)\/menu$/);
      if (menuMatch && req.method === 'POST') {
        const u = authenticated(req); owns(u, menuMatch[1]); getRestaurant(menuMatch[1]); const f = await body(req), list = getMenu(menuMatch[1]);
        const name = text(f.name, 'Название блюда', 100), price = Number(f.price); if (!Number.isInteger(price) || price < 1 || price > 1000000) fail(400, 'Проверьте цену');
        if (f.category !== undefined && !DISH_CATEGORIES.includes(f.category)) fail(400, 'Выберите категорию блюда');
        if (f.id) { const d = list.find(d => d.id === f.id); if (!d) fail(404, 'Блюдо не найдено'); d.name = name; d.price = price; if(f.category!==undefined)d.category=f.category; }
        else list.push({ id: crypto.randomUUID(), name, price, category:f.category||'Другое', desc: text(f.desc, 'Описание', 300), img: 'photo-1547592180-85f173990554' });
        putMenu(menuMatch[1], list); return json(res, 200, { menu: list });
      }
      const restaurantMatch = p.match(/^\/api\/restaurants\/([^/]+)$/);
      const lifecycleMatch = p.match(/^\/api\/restaurants\/([^/]+)\/lifecycle$/);
      if (lifecycleMatch && req.method === 'POST') {
        const u = authenticated(req, 'admin'), f = await body(req), r = getRestaurant(lifecycleMatch[1]);
        if (f.action === 'status') {
          if (!['active','inactive'].includes(f.status)) fail(400, 'Выберите статус заведения');
          if (r.deleteAt) fail(409, 'Сначала отмените удаление заведения');
          r.status = f.status;
        } else if (f.action === 'schedule-delete') {
          limit('delete-password:' + u.id, 6);
          const password = text(f.password, 'Пароль администратора', 128);
          if (!await passwordMatches(password, u.hash)) fail(403, 'Неверный пароль администратора');
          if (r.deleteAt) fail(409, 'Удаление уже запланировано');
          // Password hashing yields; reload state in case another request changed it meanwhile.
          const latest = getRestaurant(r.id);
          if (latest.deleteAt) fail(409, 'Удаление уже запланировано');
          Object.assign(r, latest, {previousStatus:latest.status,status:'inactive',deleteAt:lifecycleNow()+RETENTION_MS,deletionRequestedBy:u.id});
        } else if (f.action === 'cancel-delete') {
          if (!r.deleteAt) fail(409, 'Удаление не запланировано');
          r.status = r.previousStatus || 'inactive'; r.deleteAt = null;
          delete r.previousStatus; delete r.deletionRequestedBy;
        } else fail(400, 'Недопустимое действие');
        putRestaurant(r); return json(res, 200, {restaurant:r});
      }
      const halalReviewMatch = p.match(/^\/api\/restaurants\/([^/]+)\/halal-review$/);
      if (halalReviewMatch && req.method === 'PATCH') {
        const u = authenticated(req, 'admin'), r = getRestaurant(halalReviewMatch[1]), f = await body(req);
        if (!r.halal) fail(400, 'Сертификат не указан');
        if (!['approve', 'reject'].includes(f.action)) fail(400, 'Недопустимое действие');
        if (f.action === 'approve' && Date.parse(r.halal.validUntil + 'T23:59:59+06:00') < Date.now()) fail(400, 'Срок действия сертификата истёк');
        r.halal.status = f.action === 'approve' ? 'verified' : 'rejected';
        r.halal.reviewedBy = u.id; r.halal.reviewedAt = new Date().toISOString();
        putRestaurant(r); return json(res, 200, { restaurant: r });
      }
      if (restaurantMatch && req.method === 'PATCH') {
        const u = authenticated(req); owns(u, restaurantMatch[1]); const r = getRestaurant(restaurantMatch[1]), f = await body(req);
        r.name = text(f.name, 'Название', 80); r.desc = text(f.desc, 'Описание', 120); r.address = text(f.address, 'Адрес', 150);
        const cuisines = f.cuisines === undefined ? [f.type] : f.cuisines;
        if (!Array.isArray(cuisines) || !cuisines.length || cuisines.length > CUISINES.length || cuisines.some(c => !CUISINES.includes(c)) || new Set(cuisines).size !== cuisines.length) fail(400, 'Выберите хотя бы одну кухню из списка');
        r.cuisines = cuisines; r.type = cuisines[0];
        r.avg = Number(f.avg); if (!Number.isInteger(r.avg) || r.avg < 1 || r.avg > 1000000) fail(400, 'Проверьте средний чек');
        if (f.freeDeliveryAbove !== undefined) {
          const threshold = f.freeDeliveryAbove === '' || f.freeDeliveryAbove === null ? null : Number(f.freeDeliveryAbove);
          if (threshold !== null && (!Number.isInteger(threshold) || threshold < 0 || threshold > 1000000)) fail(400, 'Проверьте сумму для бесплатной доставки');
          r.freeDeliveryAbove = threshold;
        }
        if (f.maxGuests !== undefined) {
          const maxGuests = Number(f.maxGuests);
          if (!Number.isInteger(maxGuests) || maxGuests < 1 || maxGuests > 100) fail(400, 'Максимум гостей должен быть целым числом от 1 до 100');
          r.maxGuests = maxGuests;
        }
        if (f.halalEnabled !== undefined) {
          if (![true, false, 'on'].includes(f.halalEnabled)) fail(400, 'Проверьте статус сертификата');
          if (!f.halalEnabled) r.halal = null;
          else {
            const issuer = text(f.halalIssuer, 'Орган сертификации', 120), number = text(f.halalNumber, 'Номер сертификата', 80);
            const validUntil = text(f.halalValidUntil, 'Срок сертификата', 10), date = Date.parse(validUntil + 'T00:00:00Z');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== validUntil || Date.parse(validUntil + 'T23:59:59+06:00') < Date.now()) fail(400, 'Укажите действующий срок сертификата');
            const certificateUrl = text(f.halalCertificateUrl, 'Ссылка на сертификат', 1000);
            let parsed; try { parsed = new URL(certificateUrl); } catch { fail(400, 'Укажите HTTPS-ссылку на сертификат'); }
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail(400, 'Укажите HTTPS-ссылку на сертификат');
            const unchanged = r.halal && ['issuer','number','validUntil','certificateUrl'].every(k => r.halal[k] === ({issuer,number,validUntil,certificateUrl})[k]);
            if (!unchanged) r.halal = { issuer, number, validUntil, certificateUrl, status: 'pending' };
          }
        }
        putRestaurant(r); return json(res, 200, { restaurant: r });
      }
      if (p === '/api/admin/register' && req.method === 'POST') {
        authenticated(req, 'admin'); const f = await body(req); const restaurantName = text(f.restaurantName, 'Название заведения', 80);
        const rid = crypto.randomUUID(), u = await registerUser({ email: f.email, name: f.name, restaurant: rid });
        putRestaurant({ id: rid, name: restaurantName, type: 'Европейская', desc: 'Меню скоро появится', address: 'Адрес уточняется', rating: '—', time: '30–45', avg: 0, img: 'photo-1414235077428-338989a2e8c0', tag: 'Зарегистрированное заведение', registered: true }); putMenu(rid, []);
        return json(res, 201, { delivery: u.delivery });
      }
      if (p.startsWith('/api/')) fail(404, 'Не найдено');
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Метод не поддерживается');
      if (/^\/menu\/[^/]+$/.test(p) && !available(getRestaurant(decodeURIComponent(p.slice(6))))) fail(404, 'Заведение временно недоступно');
      const asset = ['/', '/account', '/admin', '/register'].includes(p) || /^\/menu\/[^/]+$/.test(p) ? 'index.html' : p.slice(1);
      if (!['InterVariable.woff2','Inter-LICENSE.txt','index.html','style.css','theme.css','app.js','i18n.js','auth.js','admin.js','customer.js'].includes(asset)) fail(404, 'Не найдено');
      const data = options.readAsset ? await options.readAsset(asset) : fs.readFileSync(path.join(__dirname, 'dist', asset));
      res.writeHead(200, { 'Content-Type': asset.endsWith('.woff2') ? 'font/woff2' : asset.endsWith('.txt') ? 'text/plain; charset=utf-8' : asset.endsWith('.css') ? 'text/css; charset=utf-8' : asset.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? '' : data);
    } catch (e) { if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Не удалось выполнить запрос' }); else res.end(); }
  });
  const cleanupTimer = options.disableTimer ? null : setInterval(() => { try { purge(); } catch { console.error('Не удалось выполнить отложенное удаление заведений'); } }, 60000);
  cleanupTimer?.unref();
  return { server, db, origin, close: () => new Promise(resolve => { clearInterval(cleanupTimer); server.close(() => { db.close(); resolve(); }); }) };
}
if (require.main === module) createApp().then(app => app.server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Dayin: ${app.origin}${process.env.MAIL_MODE === 'local' ? '\nЛокальная почта: ' + app.origin + '/dev/mail' : ''}`))).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { createApp };
