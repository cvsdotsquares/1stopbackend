const {
  listTestimonials,
  getTestimonialById,
  createTestimonial,
  updateTestimonial,
  softDeleteTestimonial,
} = require('../services/testimonialsService');

function parseId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

class TestimonialsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listTestimonials(this.pool, {
        status: req.query.status,
        q: req.query.q,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][TESTIMONIALS][LIST]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load testimonials',
      });
    }
  }

  async getById(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res
          .status(404)
          .json({ success: false, message: 'Testimonial not found' });
      }
      const item = await getTestimonialById(this.pool, id);
      if (!item) {
        return res
          .status(404)
          .json({ success: false, message: 'Testimonial not found' });
      }
      return res.json({ success: true, data: item });
    } catch (err) {
      console.error('[ADMIN][TESTIMONIALS][GET]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Unable to load testimonial',
      });
    }
  }

  async create(req, res) {
    try {
      const result = await createTestimonial(this.pool, req.body || {});
      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }
      return res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][TESTIMONIALS][CREATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error adding testimonial',
      });
    }
  }

  async update(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res
          .status(404)
          .json({ success: false, message: 'Testimonial not found' });
      }
      const result = await updateTestimonial(this.pool, id, req.body || {});
      if (!result.ok) {
        return res
          .status(result.message.includes('not found') ? 404 : 400)
          .json({ success: false, message: result.message });
      }
      return res.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (err) {
      console.error('[ADMIN][TESTIMONIALS][UPDATE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error updating testimonial',
      });
    }
  }

  async remove(req, res) {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        return res
          .status(404)
          .json({ success: false, message: 'Testimonial not found' });
      }
      const result = await softDeleteTestimonial(this.pool, id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][TESTIMONIALS][DELETE]', err.message);
      return res.status(500).json({
        success: false,
        message: 'Error deleting testimonial',
      });
    }
  }
}

module.exports = TestimonialsController;
