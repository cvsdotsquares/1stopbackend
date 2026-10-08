const {
  listTestimonials,
  getTestimonialById,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
} = require('../services/testimonialsService');

class TestimonialsController {
  constructor(pool) {
    this.pool = pool;
  }

  async list(req, res) {
    try {
      const data = await listTestimonials(this.pool, {
        page: req.query.page,
        name_scr: req.query.name_scr,
      });
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[ADMIN][TESTIMONIALS][LIST]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load testimonials' });
    }
  }

  async getOne(req, res) {
    try {
      const row = await getTestimonialById(this.pool, req.params.id);
      if (!row) {
        return res.status(404).json({ success: false, message: 'Testimonial not found to edit' });
      }
      return res.json({ success: true, data: row });
    } catch (err) {
      console.error('[ADMIN][TESTIMONIALS][GET]', err.message);
      return res.status(500).json({ success: false, message: 'Unable to load testimonial' });
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
        data: { id: result.id },
      });
    } catch (err) {
      console.error('[ADMIN][TESTIMONIALS][CREATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error in adding testimonial' });
    }
  }

  async update(req, res) {
    try {
      const result = await updateTestimonial(this.pool, req.params.id, req.body || {});
      if (!result.ok) {
        const status = result.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][TESTIMONIALS][UPDATE]', err.message);
      return res.status(500).json({ success: false, message: 'Error in editing testimonial' });
    }
  }

  async remove(req, res) {
    try {
      const result = await deleteTestimonial(this.pool, req.params.id);
      if (!result.ok) {
        return res.status(404).json({ success: false, message: result.message });
      }
      return res.json({ success: true, message: result.message });
    } catch (err) {
      console.error('[ADMIN][TESTIMONIALS][DELETE]', err.message);
      return res.status(500).json({ success: false, message: 'Error in deleting testimonial' });
    }
  }
}

module.exports = TestimonialsController;
