// src/controllers/allLocations.js
/**
 * All Locations Controller - handles all locations content from existing tables
 */

const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
dotenv.config();

class AllLocationsController {
  constructor(pool) {
    this.pool = pool;

    // Initialize SMTP transporter once per controller instance
    try {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
        secure: (process.env.SMTP_SECURE === 'true'), // true for 465, false for other ports
        auth: process.env.SMTP_USER && process.env.SMTP_PASS ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        } : undefined
      });
    } catch (err) {
      console.error('Failed to create SMTP transporter:', err);
      this.transporter = null;
    }
  }

  async getalllocation(req, res) {
    try {
        const courseData = [];
        const locationData = {
            locationName: '',
            locationPicture: '',
            address: [],
            coordinates: { lat: '', lng: '' },
            course_names: [],
        };
        const [content] = await this.pool.query(`
          SELECT
            l.id AS location_id,
            l.location_name,
            l.address1,
            l.address2,
            l.address3,
            l.address4,
            l.postcode,
            l.latitude,
            l.longitude,
            l.direction_map,
            lcp.locationPicture,
            GROUP_CONCAT(CONCAT(c.id, ':', c.course_name)) AS course_data
          FROM locations l
          INNER JOIN location_course_pages lcp ON lcp.location_id = l.id AND lcp.is_active = 1
          LEFT JOIN courses c ON c.id = lcp.course_id
          GROUP BY l.id, l.location_name, l.address1, l.address2, l.address3, l.address4, l.postcode, l.latitude, l.longitude, l.direction_map, lcp.locationPicture
        `);

        // Get all courses first
        const [allcourses] = await this.pool.query(`
          SELECT id, course_name FROM courses WHERE status = '1' ORDER BY course_name ASC
        `);

        const locations = content.map(location => {
          const courses = location.course_data ?
            location.course_data.split(',').map(courseItem => {
              const [id, name] = courseItem.split(':');
              return { [id]: name };
            }) : [];

          return {
            locationId: location.location_id,
            locationName: location.location_name || '',
            locationPicture: location.locationPicture ? 'uploads/location_course_files/' + location.locationPicture : '',
            address: [
              location.address1 || '',
              location.address2 || '',
              location.address3 || '',
              location.address4 || '',
              location.postcode || ''
            ],
            coordinates: {
              lat: location.latitude || '',
              lng: location.longitude || ''
            },
            direction_map: location.direction_map || '',
            courses: courses
          };
        });

        const courseList = allcourses.map(course => ({ [course.id]: course.course_name }));

        // Add homepage-style sections
        const additionalSections = await this.getHomepageStyleSections();

        res.json({
            courseData: courseList,
            locationData: locations,
            ...additionalSections
        });
    } catch (err) {
      console.error('Error fetching all locations content:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
}

  async getHomepageStyleSections() {
    const sections = {};
    const pageId = 101; // Default homepage page ID

    // Get slider images
    const [sliders] = await this.pool.query(`
      SELECT psi.slider_image, psi.alt_title, psi.image_caption
      FROM pageSliders ps
      LEFT JOIN pageSliderImg psi ON ps.id = psi.pageSliders_id
      WHERE ps.page_id = ? AND psi.slider_image IS NOT NULL
    `, [pageId]);

    if (sliders.length > 0) {
      sections.slider_images = sliders.map(img => ({
        src: '/uploads/sliders/' + img.slider_image,
        alt: img.alt_title,
        title: img.image_caption
      }));
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
      sections.about = {
        title: about[0].section_title || null,
        subtitle: about[0].section_subtitle || null,
        content: about[0].content || null,
        images: about.filter(item => item.access_img).map(item => ({
          src: '/uploads/direct_access/' + item.access_img,
          alt: item.img_title || null
        }))
      };
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
      sections.services = {
        header: services[0].service_title || null,
        services: services.filter(item => item.service_img).map((item, index) => ({
          id: index + 1,
          title: item.img_title || null,
          description: item.img_caption || null,
          image: item.service_img ? `/uploads/services/${item.service_img}` : null,
          link: item.service_url || null
        }))
      };
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
      sections.training_slider = {
        title: trainingSlider[0].slider_title || null,
        subtitle: trainingSlider[0].slider_subtitle || null,
        slides: trainingSlider.filter(item => item.slider_img).map((item, index) => ({
          id: index + 1,
          title: item.slide_title || null,
          image: item.slider_img ? '/uploads/expert_training/' + item.slider_img : null,
          link: "/" + (item.slide_title || "").toLowerCase().replace(/\s+/g, '-')
        }))
      };
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
      sections.why_us = {
        title: whyUs[0].why_title || null,
        description: whyUs[0].why_content || null,
        subtitle: whyUs[0].why_subtitle || null,
        footerText: whyUs[0].why_footer_content || null,
        courses: whyUs.filter(item => item.icon_title).map((item, index) => ({
          id: index + 1,
          title: item.icon_title,
          description: item.icon_content || null,
          icon: '/uploads/why_1stop/' + item.icon_img || null
        }))
      };
    }

    // Get CBT across London data
    const [cbtLondon] = await this.pool.query(`
      SELECT title, subtitle, description, cbt_image
      FROM cbt_across_london
      WHERE page_id = ?
    `, [pageId]);

    if (cbtLondon.length > 0) {
      sections.cbt_london = {
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
      sections.cbt_test_london = {
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
      sections.features = [{
        id: 'exceptional',
        title: exceptional[0].exceptional_title,
        subtitle: exceptional[0].exceptional_subtitle,
        content: exceptional[0].exceptional_content,
        image: '/uploads/exceptional/' + exceptional[0].exp_image,
        cta: {
          text: exceptional[0].button_title,
          link: exceptional[0].button_link
        }
      }];
    }

    // Get CTAs/banners data
    const [banners] = await this.pool.query(`
      SELECT bg_title, bg_image, button_title, button_link, bg_color, container_full_width, banner_position, title_color
      FROM pages_banner
      WHERE page_id = ?
      ORDER BY banner_position ASC
    `, [pageId]);

    if (banners.length > 0) {
      sections.banners = banners.map((banner, index) => ({
        id: index + 1,
        title: banner.bg_title || null,
        backgroundImage: banner.bg_image ? `/uploads/pages_banner/${banner.bg_image}` : null,
        backgroundColor: banner.bg_color || null,
        containerFullWidth: banner.container_full_width === '1',
        position: banner.banner_position || 0,
        titleColor: banner.title_color || 0,
        cta: {
          text: banner.button_title || null,
          link: banner.button_link || null
        }
      }));
    }

    return sections;
  }
}

module.exports = AllLocationsController;