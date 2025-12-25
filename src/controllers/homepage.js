// src/controllers/homepage.js
/**
 * Homepage Controller - handles homepage content from existing tables
 */

class HomepageController {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Get homepage content from existing database tables
   */
  async getHomepageContent(req, res) {
    try {
      const pageId = 9; // Homepage page_id

      // Build response matching homepage.json structure exactly
      const homepage = {
        about: {
          title: "",
          subtitle: "",
          paragraphs: [],
          images: []
        },
        services: {
          header: null,
          services: []
        },
        trainingSlider: {
          title: "",
          subtitle: "",
          slides: []
        },
        whyUs: {
          title: null,
          description: "",
          subtitle: "",
          courses: [],
          footerText: ""
        },
        reviews: {
          title: "What Our",
          titleHighlight: "Students Say",
          subtitle: "Don't take our word for it - hear from our successful students",
          reviews: []
        },
        accreditations: {
          title: "Our <span class=\"text-gray-900\">Accreditations</span>",
          logos: [],
          cards: [
            {
              id: 1,
              title: "Local Area's To Us",
              subtitle: "CBT Training and Motorcycle Courses across London",
              type: "locations",
              locations: [
                "High Barnet CBT", "Friern Barnet CBT", "Finchley CBT", "Southgate CBT",
                "Arnos Grove CBT", "Muswell Hill CBT", "Hornsey CBT", "Wood Green CBT", "Highgate CBT"
              ]
            },
            {
              id: 2,
              type: "gift",
            }
          ]
        },
        faqs: {
          title: "FAQS",
          subtitle: "The world of driving can be a very confusing place. So, to help out, we have compiled a list of the most frequently asked questions for you to have a browse through.",
          faqs: []
        },
        hero: {
          backgroundImages: [],
          nextCourse: {
            label: "Our Next Available CBT Course Is",
            dateText: "TOMORROW",
            ctaText: "Book Now!",
            ctaLink: "/book"
          },
          search: {
            title: "Find your training",
            placeholder: "Enter a postcode"
          },
          promotion: {},
          footerText: "CBT Test Training In London & All Other Motorbike Training In London"
        },
        ctas: [],
        features: [],
        cbtAcrossLondon: {
          title: null,
          subtitle: null,
          description: null,
          image: null
        },
        cbtTestLondon: {
          title: null,
          subtitle: null,
          description: null,
          image: null
        }
      };

      // Get hero/slider data
      const [sliders] = await this.pool.query(`
        SELECT ps.title, sbd.title as box_title, sbd.subtitle, sbd.promocode,
               sbd.book_online_button_title, sbd.book_online_button_link,
               sbd.find_cbt_button_title, sbd.find_cbt_button_link
        FROM pageSliders ps
        LEFT JOIN sliderBoxData sbd ON ps.id = sbd.pageSliders_id
        WHERE ps.page_id = ?
      `, [pageId]);

      // Get all slider images
      const [sliderImages] = await this.pool.query(`
        SELECT psi.slider_image, psi.alt_title, psi.image_caption
        FROM pageSliders ps
        LEFT JOIN pageSliderImg psi ON ps.id = psi.pageSliders_id
        WHERE ps.page_id = ? AND psi.slider_image IS NOT NULL
      `, [pageId]);

      if (sliders.length > 0) {
        homepage.hero.backgroundImages = sliderImages.map(img => ({
          src: '/uploads/sliders/' + img.slider_image,
          alt: img.alt_title,
          title: img.image_caption
        }));
        homepage.hero.promotion = {
          title: sliders[0].box_title || null,
          subtitle: sliders[0].subtitle || null,
          promoCode: sliders[0].promocode || null,
          primaryCta: {
            text: sliders[0].book_online_button_title || null,
            link: sliders[0].book_online_button_link || null
          },
          secondaryCta: {
            text: sliders[0].find_cbt_button_title || null,
            link: sliders[0].find_cbt_button_link || null
          }
        };
        homepage.hero.footerText = sliders[0].title || null;
      }

      // Get about/direct access data
      const [about] = await this.pool.query(`
        SELECT da.section_title, da.section_subtitle, da.content,
               dai.img_title, dai.access_img
        FROM direct_access da
        LEFT JOIN direct_access_image dai ON da.id = dai.direct_access_id
        WHERE da.page_id = ?
      `, [pageId]);

      if (about.length > 0) {
        homepage.about.title = about[0].section_title || null;
        homepage.about.subtitle = about[0].section_subtitle || null;
        homepage.about.paragraphs = about[0].content || null;
        homepage.about.images = about.filter(item => item.access_img).map(item => ({
          src: '/uploads/direct_access/' + item.access_img,
          alt: item.img_title || null
        }));
      }

      // Get services data
      const [services] = await this.pool.query(`
        SELECT os.service_title,
               si.service_img, si.img_title, si.img_caption, si.service_url
        FROM our_services os
        LEFT JOIN service_images si ON os.id = si.service_id
        WHERE os.page_id = ?
      `, [pageId]);

      if (services.length > 0) {
        homepage.services.header = services[0].service_title || null;
        homepage.services.services = services.filter(item => item.service_img).map((item, index) => ({
          id: index + 1,
          title: item.img_title || null,
          description: item.img_caption || null,
          image: item.service_img ? `/uploads/services/${item.service_img}` : null,
          link: item.service_url || null
        }));
      }

      // Get training slider data
      const [trainingSlider] = await this.pool.query(`
        SELECT ets.slider_title, ets.slider_subtitle,
               etsi.slider_img, etsi.slider_title as slide_title, etsi.img_caption
        FROM expert_training_slider ets
        LEFT JOIN expert_training_slider_images etsi ON ets.id = etsi.expert_training_slider_id
        WHERE ets.page_id = ?
      `, [pageId]);

      if (trainingSlider.length > 0) {
        homepage.trainingSlider.title = trainingSlider[0].slider_title || null;
        homepage.trainingSlider.subtitle = trainingSlider[0].slider_subtitle || null;
        homepage.trainingSlider.slides = trainingSlider.filter(item => item.slider_img).map((item, index) => ({
          id: index + 1,
          title: item.slide_title || null,
          image: item.slider_img ? '/uploads/expert_training/' + item.slider_img : null,
          link: "/" + (item.slide_title || "").toLowerCase().replace(/\s+/g, '-')
        }));
      }

      // Get why us data
      const [whyUs] = await this.pool.query(`
        SELECT w1s.why_title, w1s.why_subtitle, w1s.why_content, w1s.why_footer_content,
               w1si.icon_title, w1si.icon_img, w1si.icon_content
        FROM why_1stop w1s
        LEFT JOIN why_1stop_images w1si ON w1s.id = w1si.why_id
        WHERE w1s.page_id = ?
      `, [pageId]);

      if (whyUs.length > 0) {
        homepage.whyUs.title = whyUs[0].why_title || null;
        homepage.whyUs.description = whyUs[0].why_content || null;
        homepage.whyUs.subtitle = whyUs[0].why_subtitle || null;
        homepage.whyUs.footerText = whyUs[0].why_footer_content || null;
        homepage.whyUs.courses = whyUs.filter(item => item.icon_title).map((item, index) => ({
          id: index + 1,
          title: item.icon_title,
          description: item.icon_content || null,
          icon: '/uploads/why_1stop/' + item.icon_img || null
        }));
      }

      // Get CBT across London data
      const [cbtLondon] = await this.pool.query(`
        SELECT title, subtitle, description, cbt_image
        FROM cbt_across_london
        WHERE page_id = ?
      `, [pageId]);

      if (cbtLondon.length > 0) {
        homepage.cbtAcrossLondon = {
          title: cbtLondon[0].title || null,
          subtitle: cbtLondon[0].subtitle || null,
          description: cbtLondon[0].description || null,
          image: cbtLondon[0].cbt_image ? `/uploads/cbt_across_london/${cbtLondon[0].cbt_image}` : null
        };
      }

      // Get CBT test London data
      const [cbtTestLondon] = await this.pool.query(`
        SELECT title, subtitle, description, cbt_image
        FROM cbt_test_london
        WHERE page_id = ?
      `, [pageId]);

      if (cbtTestLondon.length > 0) {
        homepage.cbtTestLondon = {
          title: cbtTestLondon[0].title || null,
          subtitle: cbtTestLondon[0].subtitle || null,
          description: cbtTestLondon[0].description || null,
          image: cbtTestLondon[0].cbt_image ? `/uploads/cbt_test_london/${cbtTestLondon[0].cbt_image}` : null
        };
      }

      // Get features data
      const [exceptional] = await this.pool.query(`
        SELECT exceptional_title, exceptional_subtitle, exceptional_content,
               button_title, button_link, exp_image
        FROM our_exceptional
        WHERE page_id = ?
      `, [pageId]);

      if (exceptional.length > 0) {
        homepage.features.push({
          id: 'exceptional',
          title: exceptional[0].exceptional_title,
          subtitle: exceptional[0].exceptional_subtitle,
          content: exceptional[0].exceptional_content,
          image: '/uploads/exceptional/' + exceptional[0].exp_image,
          cta: {
            text: exceptional[0].button_title,
            link: exceptional[0].button_link
          }
        });
      }

      // Get FAQs data
      const [faqCategories] = await this.pool.query(`
        SELECT fc.id, fc.category_name, fc.weight
        FROM faq_categories fc
        ORDER BY fc.weight ASC
      `);

      const [faqs] = await this.pool.query(`
        SELECT f.faq_title, f.category_id, f.content, f.weight
        FROM faqs f
        WHERE f.status = 1
        ORDER BY f.category_id ASC, f.weight ASC
      `);

      if (faqCategories.length > 0) {
        homepage.faqs.faqs = faqCategories.map(category => ({
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

      // Get accreditations data
      const [accreditations] = await this.pool.query(`
        SELECT id, image, weight
        FROM accreditations
        ORDER BY weight ASC
      `);

      if (accreditations.length > 0) {
        homepage.accreditations.logos = accreditations.map(accreditation => ({
          id: accreditation.id,
          name: null,
          image: accreditation.image ? `/uploads/accreditations/${accreditation.image}` : null,
          alt: null
        }));
      }

      // Get CTAs/banners data
      const [banners] = await this.pool.query(`
        SELECT bg_title, bg_image, button_title, button_link, bg_color, container_full_width, banner_position
        FROM pages_banner
        WHERE page_id = ?
        ORDER BY banner_position ASC
      `, [pageId]);

      if (banners.length > 0) {
        homepage.ctas = banners.map((banner, index) => ({
          id: index + 1,
          title: banner.bg_title || null,
          backgroundImage: banner.bg_image ? `/uploads/pages_banner/${banner.bg_image}` : null,
          backgroundColor: banner.bg_color || null,
          containerFullWidth: banner.container_full_width === '1',
          position: banner.banner_position || 0,
          cta: {
            text: banner.button_title || null,
            link: banner.button_link || null
          }
        }));
      }

      // Remove pages_banner usage - not used for homepage
      // Homepage uses pageSliders for hero section instead

      res.json({
        success: true,
        data: homepage
      });

    } catch (error) {
      console.error('Error fetching homepage content:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch homepage content',
        error: error.message,
        debug: {
          pageId: pageId,
          errorStack: error.stack
        }
      });
    }
  }
}

module.exports = HomepageController;
