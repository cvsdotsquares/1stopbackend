// src/controllers/faq.js
/**
 * FAQ Controller - handles FAQ page content
 */
const { replaceTokensInObject } = require('../utils/tokenReplacer');

class FAQController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Get all FAQs grouped by category
   */
  async getFAQPageContent(req, res) {
    try {
      // Get FAQ categories (active only — status 0 is soft-deleted)
      const [faqCategories] = await this.pool.query(`
        SELECT fc.id, fc.category_name, fc.weight
        FROM faq_categories fc
        WHERE fc.status = 1
        ORDER BY fc.weight ASC
      `);

      // Get FAQs
      const [faqs] = await this.pool.query(`
        SELECT f.faq_title, f.category_id, f.content, f.weight
        FROM faqs f
        WHERE f.status = 1
        ORDER BY f.category_id ASC, f.weight ASC
      `);

      // Build response
      const faqData = {
        title: 'Frequently Asked Questions',
        subtitle: 'Find answers to common questions below.',
        categories: []
      };

      if (faqCategories.length > 0) {
        faqData.categories = faqCategories.map(category => ({
          id: category.id,
          category: category.category_name,
          questions: faqs
            .filter(faq => faq.category_id === category.id)
            .map((faq, index) => ({
              id: index + 1,
              question: faq.faq_title,
              answer: faq.content
            }))
        })).filter(category => category.questions.length > 0);
      }

      const processedFAQ = await replaceTokensInObject(this.pool, faqData);
      console.log(processedFAQ);
      res.json({
        success: true,
        data: processedFAQ
      });
    } catch (error) {
      console.error('Error fetching FAQ page content:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch FAQ page content',
        error: error.message
      });
    }
  }
}

module.exports = FAQController;
