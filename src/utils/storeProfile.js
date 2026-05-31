const db = require('../db');

function normalizeStoreProfile(input = {}) {
  const phone = String(input.phone || '').trim().slice(0, 40);
  return {
    address: String(input.address || '').trim().slice(0, 500),
    email: String(input.email || '').trim().toLowerCase().slice(0, 160),
    phone,
    upi_id: String(input.upi_id || '').trim().slice(0, 120),
    whatsappUrl: whatsappUrlForPhone(phone),
  };
}

function whatsappUrlForPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10) digits = `91${digits}`;
  if (!digits) return '';
  return `https://wa.me/${digits}`;
}

function getStoreProfile() {
  const profile = db.prepare('SELECT address, email, phone, upi_id FROM store_settings WHERE id = 1').get();
  return normalizeStoreProfile(profile || {});
}

function updateStoreProfile(input) {
  const profile = normalizeStoreProfile(input);
  db.prepare(`
    UPDATE store_settings
    SET address = ?, email = ?, phone = ?, upi_id = ?, updated_at = ?
    WHERE id = 1
  `).run(profile.address, profile.email, profile.phone, profile.upi_id, new Date().toISOString());
  return getStoreProfile();
}

module.exports = {
  getStoreProfile,
  updateStoreProfile,
  whatsappUrlForPhone,
};
