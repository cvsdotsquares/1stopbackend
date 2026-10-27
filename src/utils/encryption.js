const CryptoJS = require('crypto-js');

const AES_SECRET_KEY = process.env.AES_SECRET_KEY || 'DYhG93b0qyJuIp4kjlN8ltP9lj0wvniR2G0FgaC9mi';

exports.decryptPassword = (encryptedPassword) => {
  if (!encryptedPassword) return null;

  try {
    const decrypted = CryptoJS.AES.decrypt(encryptedPassword, AES_SECRET_KEY);
    const plainPassword = decrypted.toString(CryptoJS.enc.Utf8);

    if (!plainPassword) {
      throw new Error('Decryption failed');
    }

    return plainPassword;
  } catch (error) {
    console.error('Error decrypting password:', error);
    return null;
  }
};
