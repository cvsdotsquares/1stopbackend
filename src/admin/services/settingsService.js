const fs = require('fs');
const path = require('path');
const { phpSerialize, phpUnserialize } = require('../../utils/phpSerialize');
const { mc_encrypt } = require('../../utils/universalPassword');
const { getPublicUploadsDir } = require('../../utils/publicStaticAssets');

/**
 * Load settings row, merge unserialized `extra`, omit registraion_email_content.
 * Mirrors login.php session settings setup.
 */
async function loadAdminSettings(pool) {
  const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1 LIMIT 1');
  if (!rows || rows.length === 0) {
    return {};
  }

  const settings = { ...rows[0] };
  const extra = settings.extra ? phpUnserialize(settings.extra) : null;

  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    Object.assign(settings, extra);
  }

  delete settings.registraion_email_content;
  return settings;
}

/**
 * Get full settings for Admin Settings screen (F-070 parity with settings.php).
 */
async function getAdminSettings(pool) {
  const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1 LIMIT 1');
  const [franchiseRows] = await pool.query(
    'SELECT id, franchise_name FROM franchise WHERE isDeleted = ? ORDER BY franchise_name ASC',
    ['0']
  );

  const row = (rows && rows[0]) || {};
  let extraObj = {};
  if (row.extra) {
    try {
      const parsed = phpUnserialize(row.extra);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        extraObj = parsed;
      }
    } catch (_err) {
      extraObj = {};
    }
  }

  return {
    id: row.id || 1,
    credit_card_surcharge: Number(row.credit_card_surcharge) || 0,
    paypal_surcharge: Number(row.paypal_surcharge) || 0,
    vat_rate: Number(row.vat_rate) || 0,
    inv_days_setting: Number(row.inv_days_setting) || 0,
    booking_bcc: row.booking_bcc || '',
    site_email: row.site_email || '',
    site_contact: row.site_contact || '',
    facebook_link: row.facebook_link || '',
    twitter_link: row.twitter_link || '',
    linkedin_link: row.linkedin_link || '',
    youtube_link: row.youtube_link || '',
    registraion_email_content: row.registraion_email_content || '',
    is_voucher_setting: Number(row.is_voucher_setting) === 1 ? 1 : 0,
    voucher_franchise: row.voucher_franchise ? Number(row.voucher_franchise) : null,
    is_r2api_setting: Number(row.is_r2api_setting) === 1 ? 1 : 0,
    payment_type: String(row.payment_type || '2'),
    admin_logo_url: row.admin_logo_url || '',
    mobile_logo_url: row.mobile_logo_url || '',
    default_invoice_company: typeof extraObj.default_invoice_company === 'string' ? extraObj.default_invoice_company.trim() : '',
    has_universal_password: Boolean(row.universal_password && String(row.universal_password).length > 0),
    franchises: (franchiseRows || []).map((f) => ({
      id: f.id,
      franchise_name: f.franchise_name,
    })),
  };
}

function saveUploadFile(file, prefix) {
  if (!file || !file.buffer || !file.buffer.length) return null;
  const uploadsDir = getPublicUploadsDir();
  fs.mkdirSync(uploadsDir, { recursive: true });

  const rawExt = path.extname(file.originalname || '').toLowerCase();
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
  const ext = allowed.has(rawExt) ? rawExt : '.png';

  const fileName = `${prefix}_${Date.now()}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, fileName), file.buffer);
  return fileName;
}

/**
 * Update settings row (F-070 parity with settings.php).
 */
async function updateAdminSettings(pool, body, files = [], req = null) {
  const [currentRows] = await pool.query('SELECT * FROM settings WHERE id = 1 LIMIT 1');
  const current = (currentRows && currentRows[0]) || {};

  const creditCardSurcharge = Number(body.credit_card_surcharge) || 0;
  const paypalSurcharge = Number(body.paypal_surcharge) || 0;
  const vatRate = Number(body.vat_rate) || 0;
  const invDaysSetting = parseInt(body.inv_days_setting, 10) || 0;
  const bookingBcc = String(body.booking_bcc ?? '').trim();
  const siteEmail = String(body.site_email ?? '').trim();
  const siteContact = String(body.site_contact ?? '').trim();
  const facebookLink = String(body.facebook_link ?? '').trim();
  const twitterLink = String(body.twitter_link ?? '').trim();
  const linkedinLink = String(body.linkedin_link ?? '').trim();
  const youtubeLink = String(body.youtube_link ?? '').trim();
  const registraionEmailContent = String(body.registraion_email_content ?? '');
  const isVoucherSetting =
    body.is_voucher_setting === '1' || body.is_voucher_setting === 1 || body.is_voucher_setting === true ? 1 : 0;
  const voucherFranchise =
    body.voucher_franchise !== undefined
      ? (body.voucher_franchise ? parseInt(body.voucher_franchise, 10) : null)
      : current.voucher_franchise;
  const paymentType = String(body.payment_type) === '1' ? '1' : '2';
  const newIsR2Api =
    body.is_r2api_setting === '1' || body.is_r2api_setting === 1 || body.is_r2api_setting === true ? 1 : 0;

  // Handle file uploads (admin_logo, mobile_logo)
  const fileList = Array.isArray(files) ? files : [];
  const adminLogoFile = fileList.find((f) => f.fieldname === 'admin_logo');
  const mobileLogoFile = fileList.find((f) => f.fieldname === 'mobile_logo');

  let adminLogoUrl = current.admin_logo_url || '';
  if (adminLogoFile) {
    const saved = saveUploadFile(adminLogoFile, 'admin_logo_url');
    if (saved) adminLogoUrl = saved;
  }

  let mobileLogoUrl = current.mobile_logo_url || '';
  if (mobileLogoFile) {
    const saved = saveUploadFile(mobileLogoFile, 'mobile_logo_url');
    if (saved) mobileLogoUrl = saved;
  }

  // Handle extra (PHP serialized: default_invoice_company, etc.)
  let extraObj = {};
  if (current.extra) {
    try {
      const parsed = phpUnserialize(current.extra);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        extraObj = parsed;
      }
    } catch (_err) {
      extraObj = {};
    }
  }
  if (body.default_invoice_company !== undefined) {
    extraObj.default_invoice_company = String(body.default_invoice_company || '');
  }
  const serializedExtra = phpSerialize(extraObj);

  // Universal password encryption (only update if non-empty string provided)
  let universalPassword = current.universal_password;
  if (body.new_universal_password && String(body.new_universal_password).trim().length > 0) {
    const rawNewPass = String(body.new_universal_password).trim();
    const keyHex = process.env.UNIVERSAL_PASSWORD_KEY;
    if (keyHex) {
      universalPassword = mc_encrypt(rawNewPass, keyHex);
    } else {
      console.warn('[SETTINGS] UNIVERSAL_PASSWORD_KEY not set in environment; password not updated');
    }
  }

  // Update DB row id = 1
  await pool.query(
    `UPDATE settings SET
      credit_card_surcharge = ?,
      paypal_surcharge = ?,
      vat_rate = ?,
      inv_days_setting = ?,
      booking_bcc = ?,
      site_email = ?,
      site_contact = ?,
      facebook_link = ?,
      twitter_link = ?,
      linkedin_link = ?,
      youtube_link = ?,
      registraion_email_content = ?,
      is_voucher_setting = ?,
      voucher_franchise = ?,
      payment_type = ?,
      is_r2api_setting = ?,
      admin_logo_url = ?,
      mobile_logo_url = ?,
      extra = ?,
      universal_password = ?
    WHERE id = 1`,
    [
      creditCardSurcharge,
      paypalSurcharge,
      vatRate,
      invDaysSetting,
      bookingBcc,
      siteEmail,
      siteContact,
      facebookLink,
      twitterLink,
      linkedinLink,
      youtubeLink,
      registraionEmailContent,
      isVoucherSetting,
      voucherFranchise,
      paymentType,
      newIsR2Api,
      adminLogoUrl,
      mobileLogoUrl,
      serializedExtra,
      universalPassword,
    ]
  );

  // Refresh session if active
  if (req && req.session) {
    try {
      req.session.settings = await loadAdminSettings(pool);
    } catch (_sessionErr) {
      // non-fatal
    }
  }

  const updatedData = await getAdminSettings(pool);
  return {
    ok: true,
    message: 'Settings updated successfully',
    data: updatedData,
  };
}

module.exports = {
  loadAdminSettings,
  getAdminSettings,
  updateAdminSettings,
};
