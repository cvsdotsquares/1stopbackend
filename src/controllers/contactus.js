// src/controllers/contactus.js
/**
 * Contact Us Controller - handles contact us content from existing tables
 */

const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const { replaceTokensInObject } = require('../utils/tokenReplacer');
const { getMailFrom, getMailFromAddress } = require('../utils/mailFrom');
const { escapeHtml, cleanText } = require('../utils/injectionGuard');
dotenv.config();

class ContactUsController {
  constructor(pool) {
    this.pool = pool;

    // Initialize SMTP transporter once per controller instance
    try {
      const smtpSecure = (process.env.SMTP_SECURE === 'true');
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
        secure: smtpSecure, // true for 465 (implicit TLS), false for STARTTLS on 587/25
        // Force TLS upgrade on STARTTLS ports unless explicitly disabled
        requireTLS: !smtpSecure && process.env.SMTP_REQUIRE_TLS !== 'false',
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

  async getContactUsContent(req, res) {
    try {
        const pageId = '58';

        const contactContent = {
            page_title: "Contact Us",
            meta_title: "Contact Us - 1Stop Instruction",
            meta_desc: "Get in touch with 1Stop Instruction for any inquiries or support.",
            meta_keyword: "contact, support, inquiries, 1Stop Instruction",
            page_content: "Feel free to reach out to us through any of the following methods.",
            banner_type: 2,
            overlay_caption: 0,
            overlay_caption_text: "",
            carousel_static_image: "",
            carousel_static_caption: "",
            page_ex_rhs: "",
            featured_service: 0,
            featured_icon: "",
            testimonial_display: 0,
            featured_display: 0,
            accreditation_display: 0,
            contact_offices: [
                {
                    id: 0,
                    lname: "",
                    latitude: "",
                    longitude: "",
                    content: "",
                    weight: 0,
                    status: 1
                }
            ]
        };

        // Fetch dynamic content from the database if needed

        const [content] = await this.pool.query(`
        SELECT page_title, meta_title, meta_desc, meta_keyword, page_content, banner_type, overlay_caption,
               overlay_caption_text, carousel_static_image, carousel_static_caption,
               page_ex_rhs, featured_service, featured_icon, testimonial_display, featured_display, accreditation_display
        FROM pages
        WHERE id = ?
      `, [pageId]);

        const [offices] = await this.pool.query(`
        SELECT id, lname, latitude, longitude, content, weight, status
        FROM contact_offices
        WHERE status = 1
        ORDER BY weight ASC
      `);

        if (content.length > 0) {
            Object.assign(contactContent, content[0]);
        }
        if (offices.length > 0) {
            contactContent.contact_offices = offices.map(office => ({
                id: office.id,
                lname: office.lname,
                latitude: office.latitude,
                longitude: office.longitude,
                content: office.content,
                weight: office.weight,
                status: office.status
            }));
        }

        const processedContactContent = await replaceTokensInObject(this.pool, contactContent);

        // Add homepage-style sections
        const additionalSections = await this.getHomepageStyleSections(pageId);

        res.json({
          success: true,
          data: {
            ...processedContactContent,
            ...additionalSections
          }
        });
    } catch (error) {
      console.error('Error fetching contact us content:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async createContactUsEntry(req, res) {
    try {
      // Honeypot: bots often fill hidden fields. Silently accept and drop.
      if (String(req.body.website || req.body.company || '').trim()) {
        return res.json({ success: true, message: 'Contact entry received' });
      }

      const name = cleanText(req.body.name, 100);
      const email = cleanText(req.body.email, 254);
      const subject = cleanText(req.body.subject, 200);
      const message = cleanText(req.body.message, 5000);

      if (!name || !email || !subject || !message) {
        return res.status(400).json({ success: false, message: 'Name, email, subject and message are required' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, message: 'Invalid email format' });
      }

      const toAddress = process.env.CONTACT_TO || getMailFromAddress();
      const fromHeader = getMailFrom();
      const fromAddress = getMailFromAddress();
      const bccAddress = process.env.CONTACT_BCC || '';

      const safeName = escapeHtml(name);
      const safeEmail = escapeHtml(email);
      const safeSubject = escapeHtml(subject);
      const safeMessageHtml = escapeHtml(message).replace(/\n/g, '<br/>');

      const mailOptions = {
        from: fromHeader,
        to: toAddress,
        replyTo: email,
        subject: `Contact form submission: ${subject}`,
        text: `You have a new contact form submission:\n\nName: ${name}\nEmail: ${email}\nSubject: ${subject}\nMessage:\n${message}`,
        html: `<p>You have a new contact form submission:</p>
               <p><strong>Name:</strong> ${safeName}</p>
               <p><strong>Email:</strong> ${safeEmail}</p>
               <p><strong>Subject:</strong> ${safeSubject}</p>
               <p><strong>Message:</strong><br/>${safeMessageHtml}</p>`
      };

      // Send email if transporter is configured
      let mailInfo = null;
      if (this.transporter) {
        try {
          mailInfo = await this.transporter.sendMail(mailOptions);

          // If message was successfully sent, log it into the database
          if (mailInfo && mailInfo.messageId) {
            const getIP = require('ipware')().get_ip;
            const ipInfo = getIP(req);
            const ipAddress = ipInfo.clientIp || 'unknown';

            await this.pool.query(`
              INSERT INTO email_logs (\`to\`, cc, bcc, \`from\`, subject, email_content, email_by, status, type, ip)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [toAddress, '', bccAddress, fromAddress, subject, message, 'o', 1, 'Contact', ipAddress]);
          }
        } catch (mailErr) {
          console.error('Failed to send contact email:', mailErr);
          // don't fail the whole request if email fails; proceed to return success for DB insert
        }
      } else {
        console.warn('No SMTP transporter configured - skipping sending email');
      }

      // Return success response
      return res.json({ success: true, message: 'Contact entry received', mail: mailInfo ? { messageId: mailInfo.messageId } : null });
    } catch (error) {
      console.error('Error creating contact us entry:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async getHomepageStyleSections(pageId) {
    const sections = {};

    // Get section ordering from page_junction table (same logic as CMS pages)
    const [pageJunctions] = await this.pool.query(`
      SELECT section_data, sort_order
      FROM page_junction
      WHERE data_id = ?
      ORDER BY CAST(sort_order AS UNSIGNED) ASC, section_data ASC
    `, [pageId]);

    const normalizedSectionOrderMap = {};
    pageJunctions.forEach((junction) => {
      const normalizedKey = String(junction.section_data || '').trim().toLowerCase();
      const parsedOrder = Number(junction.sort_order);

      if (!normalizedKey || Number.isNaN(parsedOrder)) {
        return;
      }

      if (!normalizedSectionOrderMap[normalizedKey]) {
        normalizedSectionOrderMap[normalizedKey] = [];
      }

      normalizedSectionOrderMap[normalizedKey].push(parsedOrder);
    });

    const fallbackOrderCounter = {};

    const getNextSectionOrder = (keys, fallback) => {
      const keyList = Array.isArray(keys) ? keys : [keys];

      for (const key of keyList) {
        const normalizedKey = String(key || '').trim().toLowerCase();
        const orderValues = normalizedSectionOrderMap[normalizedKey];

        if (Array.isArray(orderValues) && orderValues.length > 0) {
          return orderValues.shift();
        }
      }

      const fallbackKey = String(keyList[0] || 'fallback').trim().toLowerCase();
      fallbackOrderCounter[fallbackKey] = (fallbackOrderCounter[fallbackKey] || 0) + 1;
      return fallback + (fallbackOrderCounter[fallbackKey] / 1000);
    };

    const pageSections = [];

    // Helper: format a YYYY-MM-DD string as 'DDD Do MMM' (e.g. 'Thu 23rd Apr')
    const formatNextCourseDate = (dateStr) => {
      if (!dateStr || typeof dateStr !== 'string') return null;
      const parts = dateStr.split('-');
      if (parts.length !== 3) return null;
      const year = Number.parseInt(parts[0], 10);
      const month = Number.parseInt(parts[1], 10) - 1;
      const day = Number.parseInt(parts[2], 10);
      if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
      const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const suffix = day > 3 && day < 21 ? 'th' : ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'][day % 10];
      return `${dayNames[date.getUTCDay()]} ${day}${suffix} ${monthNames[month]}`;
    };

    // Get hero/slider data (for hero section)
    const [heroSliders] = await this.pool.query(`
      SELECT ps.title, ps.next_available_text, ps.page_course_id, sbd.title as box_title, sbd.subtitle, sbd.promocode,
             sbd.book_online_button_title, sbd.book_online_button_link,
             sbd.find_cbt_button_title, sbd.find_cbt_button_link
      FROM pageSliders ps
      LEFT JOIN sliderBoxData sbd ON ps.id = sbd.pageSliders_id
      WHERE ps.page_id = ?
    `, [pageId]);

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

    let nextCourseDateFormatted = null;
    let nextCourseLocationId = null;
    let nextCourseEventId = null;
    let unformattedDate = null;

    if (heroSliders.length > 0 && heroSliders[0].page_course_id) {
      const [nextDateRows] = await this.pool.query(`
        SELECT
          DATE_FORMAT(ced.event_date, '%Y-%m-%d') as event_date,
          ce.location_id,
          ced.course_event_id,
          ce.booking_limit,
          ce.bookings_done,
          ce.current_locks
        FROM course_event_dates ced
        JOIN course_events ce ON ced.course_event_id = ce.id
        JOIN courses c ON ce.course_id = c.id
        LEFT JOIN (
          SELECT course_event_id, COUNT(*) as freeze_count
          FROM freeze
          GROUP BY course_event_id
        ) f ON f.course_event_id = ced.course_event_id
        WHERE ce.course_id = ?
          AND c.status = '1'
          AND ce.status = '1'
          AND ced.event_date > CURDATE()
          AND ced.event_date <= DATE_ADD(CURDATE(), INTERVAL 3 MONTH)
          AND ced.event_date > '1900-01-01'
          AND ced.event_date NOT IN ('1111-11-11', '0000-00-00')
          AND (ce.booking_limit - ce.bookings_done - COALESCE(ce.current_locks, 0)) > 0
          AND COALESCE(f.freeze_count, 0) = 0
        ORDER BY ced.event_date ASC, (ce.booking_limit - ce.bookings_done - COALESCE(ce.current_locks, 0)) DESC, ce.location_id ASC
        LIMIT 1
      `, [heroSliders[0].page_course_id]);

      if (nextDateRows.length > 0) {
        nextCourseDateFormatted = formatNextCourseDate(nextDateRows[0].event_date);
        nextCourseLocationId = nextDateRows[0].location_id;
        nextCourseEventId = nextDateRows[0].course_event_id;
        unformattedDate = nextDateRows[0].event_date;
      }
    }

    let heroData = null;
    if (heroSliders.length > 0) {
      heroData = {
        backgroundImages: sliders.map((img) => ({
          src: '/uploads/sliders/' + img.slider_image,
          alt: img.alt_title,
          title: img.image_caption
        })),
        nextCourse: {
          label: heroSliders[0].next_available_text || 'Our Next Available CBT Course Is',
          date: nextCourseDateFormatted,
          course_id: heroSliders[0].page_course_id || null,
          location_id: nextCourseLocationId,
          course_event_id: nextCourseEventId,
          url: nextCourseDateFormatted
            ? `/bookings?course_id=${heroSliders[0].page_course_id || ''}&location_id=${nextCourseLocationId || ''}&course_event_id=${nextCourseEventId || ''}&date=${unformattedDate}`
            : null
        },
        promotion: {
          title: heroSliders[0].box_title || null,
          subtitle: heroSliders[0].subtitle || null,
          promoCode: heroSliders[0].promocode || null,
          primaryCta: {
            text: heroSliders[0].book_online_button_title || null,
            link: heroSliders[0].book_online_button_link || null
          },
          secondaryCta: {
            text: heroSliders[0].find_cbt_button_title || null,
            link: heroSliders[0].find_cbt_button_link || null
          }
        },
        footerText: heroSliders[0].title || null
      };

      pageSections.push({
        type: 'hero',
        order: getNextSectionOrder(['home_slider', 'hero', 'hero_section'], 1),
        data: heroData
      });
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

      pageSections.push({
        type: 'about',
        order: getNextSectionOrder(['direct_access', 'about', 'about_section'], 10),
        data: sections.about
      });
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

      pageSections.push({
        type: 'services',
        order: getNextSectionOrder(['our_services', 'services', 'services_section'], 20),
        data: sections.services
      });
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

      pageSections.push({
        type: 'training_slider',
        order: getNextSectionOrder(['expert_training', 'training_slider'], 30),
        data: sections.training_slider
      });
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

      pageSections.push({
        type: 'why_us',
        order: getNextSectionOrder(['why_1stop', 'why_us', 'why_us_section'], 40),
        data: sections.why_us
      });
    }

    // Get CBT across London data
    const [cbtLondon] = await this.pool.query(`
      SELECT id, title, subtitle, description, cbt_image, marker_text, bg_color, marker_link
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

      cbtLondon.forEach((row) => {
        pageSections.push({
          type: 'cbt_london',
          order: getNextSectionOrder(['cheap_cbt_test_across_london', 'cbt_across_london', 'cbt_london'], 60),
          data: {
            title: row.title || null,
            subtitle: row.subtitle || null,
            description: row.description || null,
            marker_text: row.marker_text || null,
            marker_link: row.marker_link || null,
            bg_color: !!row.bg_color,
            image: row.cbt_image ? `/uploads/cbt_across_london/${row.cbt_image}` : null
          }
        });
      });
    }

    // Get CBT test London data
    const [cbtTestLondon] = await this.pool.query(`
      SELECT id, title, subtitle, description, cbt_image, marker_text, bg_color, title_top_center, marker_link
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

      cbtTestLondon.forEach((row) => {
        pageSections.push({
          type: 'cbt_test_london',
          order: getNextSectionOrder(['cheap_cbt_test_london', 'cbt_test_london'], 50),
          data: {
            title: row.title || null,
            subtitle: row.subtitle || null,
            description: row.description || null,
            marker_text: row.marker_text || null,
            marker_link: row.marker_link || null,
            bg_color: !!row.bg_color,
            title_top_center: row.title_top_center || null,
            image: row.cbt_image ? `/uploads/cbt_test_london/${row.cbt_image}` : null
          }
        });
      });
    }

    // Get dynamic content sections
    const [dynamicSections] = await this.pool.query(`
      SELECT *
      FROM dynamic_content_sections
      WHERE page_id = ?
      ORDER BY sort_order ASC
    `, [pageId]);

    for (let section of dynamicSections) {
      const [items] = await this.pool.query(`
        SELECT *
        FROM dynamic_content_items
        WHERE section_id = ?
        ORDER BY sort_order ASC
      `, [section.id]);

      section.items = items.map(item => ({
        ...item,
        item_content: item.item_content ? item.item_content.trim().replaceAll('\r\n', '\n') : ''
      }));

      pageSections.push({
        type: 'dynamic_content',
        order: getNextSectionOrder(['dynamic_content', 'dynamic_content_sections'], 61),
        data: section
      });
    }

    // Get info card sections
    const [infoCardSections] = await this.pool.query(`
      SELECT id, bg_color
      FROM info_card_section
      WHERE page_id = ?
      ORDER BY id ASC
    `, [pageId]);

    for (const section of infoCardSections) {
      const [infoCards] = await this.pool.query(`
        SELECT id, card_title, card_text, card_icon
        FROM info_card_data
        WHERE attached_to_card = ?
        ORDER BY id ASC
      `, [section.id]);

      pageSections.push({
        type: 'info_card_section',
        order: getNextSectionOrder(['info_card_section', 'info_cards_section', 'info_card', 'info_cards'], 65),
        data: {
          background: section.bg_color || null,
          cards: infoCards.map(card => ({
            icon: card.card_icon ? `/uploads/info_cards/${card.card_icon}` : null,
            title: card.card_title || null,
            description: card.card_text || null
          }))
        }
      });
    }

    // Get price card sections
    const [priceCardSections] = await this.pool.query(`
      SELECT id, title, note, bottom_text
      FROM price_card_sections
      WHERE page_id = ?
      ORDER BY id ASC
    `, [pageId]);

    for (const section of priceCardSections) {
      const [priceCards] = await this.pool.query(`
        SELECT id, marker_text, title, package_time, price, package_content, note_text, button_text, button_url
        FROM price_card_data
        WHERE attached_price_card = ?
        ORDER BY id ASC
      `, [section.id]);

      pageSections.push({
        type: 'price_card_section',
        order: getNextSectionOrder(['price_card_section', 'price_cards_section', 'price_card', 'price_cards'], 67),
        data: {
          title: section.title || null,
          note: section.note || null,
          bottom_text: section.bottom_text || null,
          cards: priceCards.map(card => ({
            marker_text: card.marker_text || null,
            title: card.title || null,
            time: card.package_time || null,
            price: card.price || null,
            description: card.package_content || null,
            note_text: card.note_text || null,
            button: {
              text: card.button_text || null,
              url: card.button_url || null
            }
          }))
        }
      });
    }

    // Get service areas sections
    const [serviceAreasSections] = await this.pool.query(`
      SELECT id, border, show_bg, bullet_type
      FROM service_areas_section
      WHERE page_id = ?
      ORDER BY id ASC
    `, [pageId]);

    for (const section of serviceAreasSections) {
      const [serviceAreas] = await this.pool.query(`
        SELECT id, left_text, right_text
        FROM service_areas_data
        WHERE attached_to_service = ?
        ORDER BY id ASC
      `, [section.id]);

      pageSections.push({
        type: 'service_areas_section',
        order: getNextSectionOrder(['service_areas_section', 'service_area_section', 'service_areas', 'service_area'], 68),
        data: {
          border: !!section.border,
          show_bg: !!section.show_bg,
          bullet_type: section.bullet_type || null,
          areas: serviceAreas.map(area => ({
            left_text: area.left_text || null,
            right_text: area.right_text || null
          }))
        }
      });
    }

    // Get accordion sections
    const [accordionSections] = await this.pool.query(`
      SELECT id, header_txt
      FROM accordion_section
      WHERE page_id = ?
      ORDER BY id ASC
    `, [pageId]);

    for (const section of accordionSections) {
      const [accordionItems] = await this.pool.query(`
        SELECT id, accordion_title, accordion_text
        FROM accordion_sec_data
        WHERE ref_accordion = ?
        ORDER BY id ASC
      `, [section.id]);

      pageSections.push({
        type: 'accordion_section',
        order: getNextSectionOrder(['accordion_section', 'accordion_sections', 'accordion', 'accordion_sec'], 69),
        data: {
          header: section.header_txt || null,
          items: accordionItems.map(item => ({
            title: item.accordion_title || null,
            content: item.accordion_text || null
          }))
        }
      });
    }

    // Get content cards sections
    const [contentCardsSections] = await this.pool.query(`
      SELECT id, content_text
      FROM content_cards_section
      WHERE page_id = ?
      ORDER BY id ASC
    `, [pageId]);

    for (const section of contentCardsSections) {
      const [contentCardItems] = await this.pool.query(`
        SELECT id, item_img_uri, item_title, item_text, red_btn_txt, red_btn_url, blue_btn_txt, blue_btn_url, marker_text
        FROM content_cards_items
        WHERE ref_content_card = ?
        ORDER BY id ASC
      `, [section.id]);

      pageSections.push({
        type: 'content_cards_section',
        order: getNextSectionOrder(['content_cards_section', 'content_card_section', 'content_cards', 'content_card'], 71),
        data: {
          content_text: section.content_text || null,
          cards: contentCardItems.map(item => ({
            image: item.item_img_uri ? `/uploads/content_cards/${item.item_img_uri}` : null,
            title: item.item_title || null,
            description: item.item_text || null,
            marker_text: item.marker_text || null,
            red_button: {
              text: item.red_btn_txt || null,
              url: item.red_btn_url || null
            },
            blue_button: {
              text: item.blue_btn_txt || null,
              url: item.blue_btn_url || null
            }
          }))
        }
      });
    }

    // CMS sidebar (reads from pages table)
    const [cmsSidebarRows] = await this.pool.query(`
      SELECT page_ex_rhs
      FROM pages
      WHERE id = ?
    `, [pageId]);

    const cmsSidebarItems = cmsSidebarRows
      .filter(item => item.page_ex_rhs !== null && item.page_ex_rhs !== undefined && String(item.page_ex_rhs).trim() !== '')
      .map(item => ({
        text: item.page_ex_rhs
      }));

    if (cmsSidebarItems.length > 0) {
      pageSections.push({
        type: 'cms_sidebar',
        order: getNextSectionOrder(['cms_sidebar', 'sidebar', 'cms_sidebar_section'], 72),
        data: { items: cmsSidebarItems }
      });
    }

    // Tab sections
    const [tabSections] = await this.pool.query(`
      SELECT id, title, image_uri
      FROM tab_section
      WHERE page_id = ?
      ORDER BY id ASC
    `, [pageId]);

    for (const section of tabSections) {
      const [tabs] = await this.pool.query(`
        SELECT id, tab_name, tab_text, tab_icon_url
        FROM tabs
        WHERE attached_to_tab = ?
        ORDER BY id ASC
      `, [section.id]);

      pageSections.push({
        type: 'tab_section',
        order: getNextSectionOrder(['directions_parking', 'tab_section', 'tabs', 'tabs_section'], 70),
        data: {
          title: section.title || null,
          image: section.image_uri ? '/uploads/directions/' + section.image_uri : null,
          tabs: tabs.map(tab => ({
            id: tab.id.toString(),
            label: tab.tab_name || null,
            icon: tab.tab_icon_url ? '/uploads/tabs/' + tab.tab_icon_url : null,
            content: tab.tab_text || null
          }))
        }
      });
    }

    // Process steps
    const [processStepsSections] = await this.pool.query(`
      SELECT id, process_step_title
      FROM process_steps
      WHERE page_id = ?
      ORDER BY id ASC
    `, [pageId]);

    for (const section of processStepsSections) {
      const [stepContent] = await this.pool.query(`
        SELECT id, step_no, step_title, step_description, sort_order
        FROM process_step_content
        WHERE main_process_ref = ?
        ORDER BY sort_order ASC
      `, [section.id]);

      pageSections.push({
        type: 'process_steps',
        order: getNextSectionOrder(['process_steps', 'process_step', 'process_steps_section'], 73),
        data: {
          title: section.process_step_title || null,
          steps: stepContent.map(step => ({
            step_no: step.step_no || null,
            title: step.step_title || null,
            description: step.step_description || null
          }))
        }
      });
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

      pageSections.push({
        type: 'features',
        order: getNextSectionOrder(['our_exceptional', 'features', 'features_section'], 80),
        data: sections.features
      });
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

      sections.banners.forEach((banner) => {
        pageSections.push({
          type: 'banner',
          order: getNextSectionOrder(['page_banner', 'pages_banner', 'banner', 'banners'], 90),
          data: banner
        });
      });
    }

    pageSections.sort((a, b) => a.order - b.order);
    sections.sections = pageSections;

    return sections;
  }
}

module.exports = ContactUsController;
