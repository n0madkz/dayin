// Reserved contract for the future customer flow. No public registration or messaging is enabled.
const customerAuth = Object.freeze({ enabled: false, identity: 'phone', verificationChannel: 'whatsapp' });
function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^[+\d\s()-]+$/.test(value)) throw new Error('Укажите номер телефона с кодом страны');
  const phone = value.replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Укажите номер телефона с кодом страны');
  return phone;
}
function futureRegistrationRequest(fields) { return { phone: normalizePhone(fields.phone), channel: 'whatsapp', purpose: 'customer-sign-in' }; }
async function sendWhatsAppCode() { throw new Error('Клиентская регистрация отключена. WhatsApp не подключён.'); }
module.exports = { customerAuth, normalizePhone, futureRegistrationRequest, sendWhatsAppCode };
