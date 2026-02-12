// src/controllers/user.js
class UserController {
  constructor(pool) {
    this.pool = pool;
  }

  async getProfile(req, res) {
    try {
      const [users] = await this.pool.query(`
        SELECT id, first_name, sur_name, email, contact1, add1, add2, postcode, created
        FROM users WHERE id = ?
      `, [req.user.id]);

      if (!users.length) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const user = users[0];
      res.json({
        success: true,
        data: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.sur_name,
          email: user.email,
          phone: user.contact1,
          date_of_birth: null,
          address: {
            street: user.add1,
            city: user.add2,
            postcode: user.postcode,
            country: 'United Kingdom'
          },
          license_number: null,
          created_at: user.created
        }
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ success: false, message: 'Failed to get profile' });
    }
  }

  async updateProfile(req, res) {
    try {
      const { first_name, last_name, phone, address } = req.body;
      const updates = [];
      const values = [];

      if (first_name) { updates.push('first_name = ?'); values.push(first_name); }
      if (last_name) { updates.push('sur_name = ?'); values.push(last_name); }
      if (phone) { updates.push('contact1 = ?'); values.push(phone); }
      if (address?.street) { updates.push('add1 = ?'); values.push(address.street); }
      if (address?.city) { updates.push('add2 = ?'); values.push(address.city); }
      if (address?.postcode) { updates.push('postcode = ?'); values.push(address.postcode); }

      if (!updates.length) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      updates.push('modified = NOW()');
      values.push(req.user.id);

      await this.pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

      const [updated] = await this.pool.query(`
        SELECT id, first_name, sur_name, email, contact1, add1, add2, postcode
        FROM users WHERE id = ?
      `, [req.user.id]);

      const user = updated[0];
      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.sur_name,
          email: user.email,
          phone: user.contact1,
          date_of_birth: null,
          address: {
            street: user.add1,
            city: user.add2,
            postcode: user.postcode,
            country: 'United Kingdom'
          },
          license_number: null
        }
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
  }
}

module.exports = UserController;
