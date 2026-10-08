const fs = require('fs');
const path = require('path');
const {
  trim,
  decodeHtml,
  htmlEscape,
  checkboxFlag,
  positiveInt,
  createFileAccessor,
  saveUniqUpload,
  saveUniqTrueUpload,
  saveTimeBasenameUpload,
  upsertJunction,
  ensureJunctionExists,
} = require('./helpers');

function ctx(pool, pageId, dataType, body, files, getUploadDir) {
  const fileAccess = createFileAccessor(files);
  return {
    pool,
    pageId,
    dataType,
    body,
    files,
    getUploadDir: getUploadDir || ((subdir) => require('./helpers').getFrontUploadDir(subdir)),
    fileAccess,
  };
}

async function saveHomeSlider(c) {
  const sliders = c.body.pageSliders;
  if (!sliders || (typeof sliders === 'object' && !Object.keys(sliders).length)) {
    return;
  }

  const pageId = positiveInt(c.body.page_id) || c.pageId;
  const sectionTitle = decodeHtml(sliders.title);
  const nextAvailableText = trim(sliders.next_available_text ?? '');
  const pageCourseId = positiveInt(sliders.page_course_id);
  let sliderRowId = positiveInt(sliders.slider_id);

  if (sliderRowId) {
    const [existingJunction] = await c.pool.query(
      `SELECT sort_order FROM page_junction WHERE data_id = ? AND data_type = ? AND section_data = 'home_slider'`,
      [pageId, c.dataType]
    );
    const sortOrder = existingJunction?.[0]?.sort_order ?? 1;
    await c.pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND data_type = ? AND section_data = 'home_slider'`,
      [pageId, c.dataType]
    );
    await c.pool.query(
      `INSERT INTO page_junction (data_id, data_type, section_data, sort_order) VALUES (?, ?, 'home_slider', ?)`,
      [pageId, c.dataType, sortOrder]
    );

    await c.pool.query(
      `UPDATE pageSliders SET title = ?, next_available_text = ?, page_course_id = ? WHERE page_id = ?`,
      [sectionTitle, nextAvailableText, pageCourseId, pageId]
    );

    const box = c.body.sliderBoxData;
    if (box && sliderRowId) {
      const promocode = box.promocode ?? '';
      await c.pool.query(
        `UPDATE sliderBoxData SET
          title = ?, subtitle = ?, book_online_button_title = ?, book_online_button_link = ?,
          find_cbt_button_title = ?, find_cbt_button_link = ?, promocode = ?
         WHERE pageSliders_id = ?`,
        [
          decodeHtml(box.title),
          decodeHtml(box.subtitle),
          decodeHtml(box.book_online_button_title),
          htmlEscape(box.book_online_button_link),
          decodeHtml(box.find_cbt_button_title),
          box.find_cbt_button_link ?? '',
          promocode,
          sliderRowId,
        ]
      );
    }
  } else {
    const [ins] = await c.pool.query(
      `INSERT INTO pageSliders (page_id, page_type, title, next_available_text, page_course_id)
       VALUES (?, ?, ?, ?, ?)`,
      [pageId, c.dataType, sectionTitle, nextAvailableText, pageCourseId]
    );
    sliderRowId = ins.insertId;
    await c.pool.query(
      `INSERT INTO page_junction (data_id, data_type, section_data) VALUES (?, ?, 'home_slider')`,
      [pageId, c.dataType]
    );

    const box = c.body.sliderBoxData || {};
    const promocode = box.promocode ?? '';
    await c.pool.query(
      `INSERT INTO sliderBoxData (
        pageSliders_id, title, subtitle, book_online_button_title, book_online_button_link,
        find_cbt_button_title, find_cbt_button_link, promocode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sliderRowId,
        decodeHtml(box.title),
        decodeHtml(box.subtitle),
        decodeHtml(box.book_online_button_title),
        htmlEscape(box.book_online_button_link),
        decodeHtml(box.find_cbt_button_title),
        htmlEscape(box.find_cbt_button_link),
        promocode,
      ]
    );
  }

  const imgMeta = c.body.direct_access_images_slider;
  if (!imgMeta?.alt_title) return;

  const uploadDir = c.getUploadDir('sliders');
  const altTitles = Array.isArray(imgMeta.alt_title)
    ? imgMeta.alt_title
    : Object.values(imgMeta.alt_title);

  for (let index = 0; index < altTitles.length; index++) {
    const accessTitle = htmlEscape(altTitles[index]);
    let accessId = positiveInt(imgMeta.image_id?.[index] ?? imgMeta.image_id?.[String(index)]);
    const caption = imgMeta.image_caption?.[index] ?? imgMeta.image_caption?.[String(index)] ?? '';
    const image_caption = htmlEscape(caption);

    const file =
      c.fileAccess.getFile(['direct_access_images_slider', index, 'slider_image']) ||
      c.fileAccess.getFile(['direct_access_images_slider', 'slider_image', index]);

    let accessImg = '';
    if (file?.buffer?.length) {
      accessImg = saveUniqTrueUpload(file, uploadDir, 'direct_') || '';
      if (!accessImg) continue;
    }

    if (accessId) {
      const fields = ['alt_title = ?'];
      const params = [accessTitle];
      if (file?.buffer?.length) {
        fields.push('image_caption = ?', 'slider_image = ?');
        params.push(image_caption, accessImg);
      }
      params.push(accessId);
      await c.pool.query(
        `UPDATE pageSliderImg SET ${fields.join(', ')} WHERE id = ?`,
        params
      );
    } else if (file?.buffer?.length) {
      await c.pool.query(
        `INSERT INTO pageSliderImg (pageSliders_id, alt_title, image_caption, slider_image)
         VALUES (?, ?, ?, ?)`,
        [sliderRowId, accessTitle, image_caption, accessImg]
      );
    }
  }
}

async function saveDirectAccess(c) {
  const sections = c.body.direct_access;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;
  const uploadDir = c.getUploadDir('direct_access');

  for (const instanceKey of Object.keys(sections)) {
    const section = sections[instanceKey];
    const sectionTitle = decodeHtml(section.section_title ?? '');
    const content = decodeHtml(section.content ?? '');
    const sort_order = Number(section.sort_order) || Number(instanceKey) + 1;
    let directAccessId = positiveInt(section.section_id);

    if (directAccessId) {
      await c.pool.query(
        `UPDATE direct_access SET section_title = ?, content = ? WHERE id = ? AND page_id = ?`,
        [sectionTitle, content, directAccessId, pageId]
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'direct_access',
        sectionId: directAccessId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO direct_access (page_id, page_type, section_title, content) VALUES (?, ?, ?, ?)`,
        [pageId, c.dataType, sectionTitle, content]
      );
      directAccessId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, sort_order, section_id)
         VALUES (?, ?, 'direct_access', ?, ?)`,
        [pageId, c.dataType, sort_order, directAccessId]
      );
    }

    const images = section.images;
    if (!images) continue;

    for (const imgKey of Object.keys(images)) {
      const image = images[imgKey];
      const imgTitle = decodeHtml(image.img_title ?? '');
      const imageId = positiveInt(image.image_id);
      const file = c.fileAccess.getFile([
        'direct_access',
        instanceKey,
        'images',
        imgKey,
        'access_img',
      ]);

      let accessImg = '';
      if (file?.buffer?.length) {
        accessImg = saveUniqTrueUpload(file, uploadDir, 'direct_') || '';
        if (!accessImg) continue;
      }

      if (imageId) {
        if (accessImg) {
          await c.pool.query(
            `UPDATE direct_access_image SET img_title = ?, access_img = ? WHERE id = ?`,
            [imgTitle, accessImg, imageId]
          );
        } else {
          await c.pool.query(
            `UPDATE direct_access_image SET img_title = ? WHERE id = ?`,
            [imgTitle, imageId]
          );
        }
      } else if (accessImg) {
        await c.pool.query(
          `INSERT INTO direct_access_image (direct_access_id, img_title, access_img) VALUES (?, ?, ?)`,
          [directAccessId, imgTitle, accessImg]
        );
      } else if (imgTitle) {
        await c.pool.query(
          `INSERT INTO direct_access_image (direct_access_id, img_title, access_img) VALUES (?, ?, ?)`,
          [directAccessId, imgTitle, '']
        );
      }
    }
  }
}

async function saveOurServices(c) {
  const services = c.body.service;
  if (!services || !Object.keys(services).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;
  const uploadDir = c.getUploadDir('services');

  for (const instance of Object.keys(services)) {
    const service = services[instance];
    const serviceTitle = decodeHtml(service.service_title ?? '');
    let serviceId = positiveInt(service.section_id);
    const sort_order = Number(service.sort_order) || 1;

    if (serviceId) {
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'our_services',
        sectionId: serviceId,
        sortOrder: sort_order,
      });
      await c.pool.query(`UPDATE our_services SET service_title = ? WHERE id = ?`, [
        serviceTitle,
        serviceId,
      ]);
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO our_services (page_id, page_type, service_title) VALUES (?, ?, ?)`,
        [pageId, 'page', serviceTitle]
      );
      serviceId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, ?, 'our_services', ?, ?)`,
        [pageId, c.dataType, serviceId, sort_order]
      );
    }

    const images = c.body.service_images?.[instance];
    if (!images) continue;

    for (const imageIndex of Object.keys(images)) {
      const imageData = images[imageIndex];
      const imageTitle = decodeHtml(imageData.img_title ?? '');
      const imageCaption = decodeHtml(imageData.img_caption ?? '');
      const serviceUrl = trim(imageData.service_url ?? '');
      const imageId = positiveInt(imageData.image_id);
      const file = c.fileAccess.getFile(['service_images', instance, imageIndex]);

      let uploadedImg = '';
      if (file?.buffer?.length) {
        uploadedImg = saveUniqUpload(file, uploadDir, 'service_') || '';
      }

      if (imageId) {
        const fields = ['img_title = ?', 'img_caption = ?', 'service_url = ?'];
        const params = [imageTitle, imageCaption, serviceUrl];
        if (uploadedImg) {
          fields.push('service_img = ?');
          params.push(uploadedImg);
        }
        params.push(imageId);
        await c.pool.query(
          `UPDATE service_images SET ${fields.join(', ')} WHERE id = ?`,
          params
        );
      } else if (imageTitle || imageCaption || serviceUrl || uploadedImg) {
        await c.pool.query(
          `INSERT INTO service_images (service_id, img_title, service_img, img_caption, service_url)
           VALUES (?, ?, ?, ?, ?)`,
          [serviceId, imageTitle, uploadedImg, imageCaption, serviceUrl]
        );
      }
    }
  }
}

async function saveCbtAcrossLondon(c) {
  const sections = c.body.cbtservice;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;
  const uploadDir = c.getUploadDir('cbt_across_london');

  for (const instanceIndex of Object.keys(sections)) {
    const section = sections[instanceIndex];
    const serviceTitle = decodeHtml(section.title ?? '');
    const servicesubtitle = decodeHtml(section.subtitle ?? '');
    const servicedescription = decodeHtml(section.description ?? '');
    const marker_text = trim(section.marker_text ?? '');
    const marker_link = trim(section.marker_link ?? '');
    const bg_color = checkboxFlag(section, 'bg_color');
    const sort_order = Number(section.sort_order) || Number(instanceIndex) + 1;
    let cbtId = positiveInt(section.section_id);

    if (cbtId) {
      await c.pool.query(
        `UPDATE cbt_across_london SET title = ?, subtitle = ?, description = ?, marker_text = ?, marker_link = ?, bg_color = ?
         WHERE id = ? AND page_id = ?`,
        [
          serviceTitle,
          servicesubtitle,
          servicedescription,
          marker_text,
          marker_link,
          bg_color,
          cbtId,
          pageId,
        ]
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'cheap_cbt_test_across_london',
        sectionId: cbtId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO cbt_across_london (page_id, page_type, title, subtitle, description, marker_text, marker_link, bg_color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pageId,
          c.dataType,
          serviceTitle,
          servicesubtitle,
          servicedescription,
          marker_text,
          marker_link,
          bg_color,
        ]
      );
      cbtId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, sort_order, section_id)
         VALUES (?, ?, 'cheap_cbt_test_across_london', ?, ?)`,
        [pageId, c.dataType, sort_order, cbtId]
      );
    }

    const file = c.fileAccess.getFile(['cbtservice', instanceIndex, 'cbt_image']);
    if (file?.buffer?.length) {
      const cbt_image = saveUniqUpload(file, uploadDir, 'cbt_');
      if (cbt_image) {
        await c.pool.query(`UPDATE cbt_across_london SET cbt_image = ? WHERE id = ?`, [
          cbt_image,
          cbtId,
        ]);
      }
    }
  }
}

async function saveCbtTestLondon(c) {
  const sections = c.body.service_incbt;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;
  const uploadDir = c.getUploadDir('cbt_test_london');

  for (const instanceIndex of Object.keys(sections)) {
    const section = sections[instanceIndex];
    const serviceTitle = decodeHtml(section.title ?? '');
    const servicesubtitle = decodeHtml(section.subtitle ?? '');
    const servicedescription = decodeHtml(section.description ?? '');
    const marker_text = trim(section.marker_text ?? '');
    const marker_link = trim(section.marker_link ?? '');
    const bg_color = checkboxFlag(section, 'bg_color');
    const title_top_center = checkboxFlag(section, 'title_top_center');
    const sort_order = Number(section.sort_order) || Number(instanceIndex) + 1;
    let cbtInLondonId = positiveInt(section.section_id);

    if (cbtInLondonId) {
      await c.pool.query(
        `UPDATE cbt_test_london SET title = ?, subtitle = ?, description = ?, marker_text = ?, marker_link = ?, bg_color = ?, title_top_center = ?
         WHERE id = ? AND page_id = ?`,
        [
          serviceTitle,
          servicesubtitle,
          servicedescription,
          marker_text,
          marker_link,
          bg_color,
          title_top_center,
          cbtInLondonId,
          pageId,
        ]
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'cheap_cbt_test_london',
        sectionId: cbtInLondonId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO cbt_test_london (page_id, page_type, title, subtitle, description, marker_text, marker_link, bg_color, title_top_center)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pageId,
          c.dataType,
          serviceTitle,
          servicesubtitle,
          servicedescription,
          marker_text,
          marker_link,
          bg_color,
          title_top_center,
        ]
      );
      cbtInLondonId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, sort_order, section_id)
         VALUES (?, ?, 'cheap_cbt_test_london', ?, ?)`,
        [pageId, c.dataType, sort_order, cbtInLondonId]
      );
    }

    const file = c.fileAccess.getFile(['service_incbt', instanceIndex, 'cbt_image']);
    if (file?.buffer?.length) {
      const cbt_image = saveUniqUpload(file, uploadDir, 'cbtin_');
      if (cbt_image) {
        await c.pool.query(`UPDATE cbt_test_london SET cbt_image = ? WHERE id = ?`, [
          cbt_image,
          cbtInLondonId,
        ]);
      }
    }
  }
}

async function saveCmsSidebar(c) {
  const pageId = positiveInt(c.body.page_id) || c.pageId;
  const items = c.body.cms_sidebar_items;

  if (items && Object.keys(items).length) {
    await c.pool.query(`DELETE FROM cms_sidebar WHERE page_id = ?`, [pageId]);

    const list = Array.isArray(items) ? items : Object.values(items);
    for (let index = 0; index < list.length; index++) {
      const item = list[index];
      const sidebar_item_title = trim(item.sidebar_item_title ?? '');
      const sidebar_item_text = trim(item.sidebar_item_text ?? '');
      const sort_order = Number(item.sort_order) || index + 1;
      if (!sidebar_item_title && !sidebar_item_text) continue;
      await c.pool.query(
        `INSERT INTO cms_sidebar (sidebar_item_title, sidebar_item_text, sort_order, page_id)
         VALUES (?, ?, ?, ?)`,
        [sidebar_item_title, sidebar_item_text, sort_order, pageId]
      );
    }
    await ensureJunctionExists(c.pool, pageId, c.dataType, 'cms_sidebar');
  } else {
    await c.pool.query(`DELETE FROM cms_sidebar WHERE page_id = ?`, [pageId]);
    await c.pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND data_type = ? AND section_data = 'cms_sidebar'`,
      [pageId, c.dataType]
    );
  }
}

async function saveExpertTraining(c) {
  const sections = c.body.exp_service;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;
  const uploadDir = c.getUploadDir('expert_training');

  for (const instance of Object.keys(sections)) {
    const service = sections[instance];
    const serviceTitle = decodeHtml(service.slider_title ?? '');
    const slider_subtitle = decodeHtml(service.slider_subtitle ?? '');
    const sort_order = Number(service.sort_order) || 1;
    let directAccessId = positiveInt(service.section_id);

    if (directAccessId) {
      await c.pool.query(
        `UPDATE expert_training_slider SET slider_title = ?, slider_subtitle = ? WHERE id = ?`,
        [serviceTitle, slider_subtitle, directAccessId]
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'expert_training',
        sectionId: directAccessId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO expert_training_slider (page_id, page_type, slider_title, slider_subtitle) VALUES (?, 'page', ?, ?)`,
        [pageId, serviceTitle, slider_subtitle]
      );
      directAccessId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, 'page', 'expert_training', ?, ?)`,
        [pageId, directAccessId, sort_order]
      );
    }

    const images = c.body.exp_service_images?.[instance];
    if (!images) continue;

    for (const imageIndex of Object.keys(images)) {
      const imageData = images[imageIndex];
      const imageId = positiveInt(imageData.image_id);
      const imgTitle = decodeHtml(imageData.img_title ?? '');
      const imgCaption = decodeHtml(imageData.img_caption ?? '');
      const imgLink = decodeHtml(imageData.img_link ?? '');
      const file = c.fileAccess.getFile(['exp_service_images', instance, imageIndex]);

      let uploadedImg = '';
      if (file?.buffer?.length) {
        uploadedImg = saveUniqUpload(file, uploadDir, 'expert_') || '';
      }

      if (imageId) {
        if (uploadedImg) {
          await c.pool.query(
            `UPDATE expert_training_slider_images SET slider_title = ?, img_caption = ?, img_link = ?, slider_img = ? WHERE id = ?`,
            [imgTitle, imgCaption, imgLink, uploadedImg, imageId]
          );
        } else {
          await c.pool.query(
            `UPDATE expert_training_slider_images SET slider_title = ?, img_caption = ?, img_link = ? WHERE id = ?`,
            [imgTitle, imgCaption, imgLink, imageId]
          );
        }
      } else if (uploadedImg || imgTitle || imgCaption || imgLink) {
        await c.pool.query(
          `INSERT INTO expert_training_slider_images (expert_training_slider_id, slider_title, img_caption, img_link, slider_img)
           VALUES (?, ?, ?, ?, ?)`,
          [directAccessId, imgTitle, imgCaption, imgLink, uploadedImg]
        );
      }
    }
  }
}

async function saveWhy1stop(c) {
  const sections = c.body.why;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;
  const uploadDir = c.getUploadDir('why_1stop');

  for (const instance of Object.keys(sections)) {
    const section = sections[instance];
    const whyTitle = decodeHtml(section.why_title ?? '');
    const whySubtitle = decodeHtml(section.why_subtitle ?? '');
    const whyContent = decodeHtml(section.why_content ?? '');
    const whyFooterContent = decodeHtml(section.why_footer_content ?? '');
    const sort_order = Number(section.sort_order) || 1;
    let whyId = positiveInt(section.section_id);

    if (whyId) {
      await c.pool.query(
        `UPDATE why_1stop SET why_title = ?, why_subtitle = ?, why_content = ?, why_footer_content = ? WHERE id = ?`,
        [whyTitle, whySubtitle, whyContent, whyFooterContent, whyId]
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'why_1stop',
        sectionId: whyId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO why_1stop (page_id, page_type, why_title, why_subtitle, why_content, why_footer_content)
         VALUES (?, 'page', ?, ?, ?, ?)`,
        [pageId, whyTitle, whySubtitle, whyContent, whyFooterContent]
      );
      whyId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, 'page', 'why_1stop', ?, ?)`,
        [pageId, whyId, sort_order]
      );
    }

    const images = c.body.why_images?.[instance];
    if (!images) continue;

    for (const imageIndex of Object.keys(images)) {
      const imageData = images[imageIndex];
      const iconId = positiveInt(imageData.icon_id);
      const iconTitle = decodeHtml(imageData.icon_title ?? '');
      const iconContent = decodeHtml(imageData.icon_content ?? '');
      const iconLinkTitle = decodeHtml(imageData.icon_link_title ?? '');
      const iconLink = decodeHtml(imageData.icon_link ?? '');
      const file = c.fileAccess.getFile(['why_images', instance, imageIndex]);

      let uploadedImg = '';
      if (file?.buffer?.length) {
        uploadedImg = saveUniqUpload(file, uploadDir, 'why_') || '';
      }

      if (iconId) {
        if (uploadedImg) {
          await c.pool.query(
            `UPDATE why_1stop_images SET icon_title = ?, icon_content = ?, icon_img = ?, icon_link_title = ?, icon_link = ? WHERE id = ?`,
            [iconTitle, iconContent, uploadedImg, iconLinkTitle, iconLink, iconId]
          );
        } else {
          await c.pool.query(
            `UPDATE why_1stop_images SET icon_title = ?, icon_content = ?, icon_link_title = ?, icon_link = ? WHERE id = ?`,
            [iconTitle, iconContent, iconLinkTitle, iconLink, iconId]
          );
        }
      } else if (uploadedImg || iconTitle || iconContent) {
        await c.pool.query(
          `INSERT INTO why_1stop_images (why_id, icon_title, icon_content, icon_img, icon_link_title, icon_link)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [whyId, iconTitle, iconContent, uploadedImg, iconLinkTitle, iconLink]
        );
      }
    }
  }
}

async function saveDirectionsParking(c) {
  const sections = c.body.directions;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;
  const uploadDirMain = c.getUploadDir('directions');
  const uploadDirTabs = c.getUploadDir('tabs');

  for (const instanceIndex of Object.keys(sections)) {
    const directionsData = sections[instanceIndex];
    const directionsTitle = decodeHtml(directionsData.title ?? '');
    let directionsId = positiveInt(directionsData.section_id);
    const sort_order = Number(directionsData.sort_order) || 1;

    const mainFile = c.fileAccess.getFile(['directions', instanceIndex, 'image_uri']);
    let imageUri = '';
    if (mainFile?.buffer?.length) {
      imageUri = saveTimeBasenameUpload(mainFile, uploadDirMain) || '';
    }

    if (directionsId) {
      const fields = ['title = ?'];
      const params = [directionsTitle];
      if (imageUri) {
        fields.push('image_uri = ?');
        params.push(imageUri);
      }
      params.push(directionsId);
      await c.pool.query(
        `UPDATE tab_section SET ${fields.join(', ')} WHERE id = ?`,
        params
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'directions_parking',
        sectionId: directionsId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO tab_section (page_id, title, image_uri) VALUES (?, ?, ?)`,
        [pageId, directionsTitle, imageUri]
      );
      directionsId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, ?, 'directions_parking', ?, ?)`,
        [pageId, c.dataType, directionsId, sort_order]
      );
    }

    const tabs = directionsData.tabs;
    const tabNames = tabs?.tab_name;
    if (!tabNames) continue;

    const names = Array.isArray(tabNames) ? tabNames : Object.values(tabNames);
    for (let tabIndex = 0; tabIndex < names.length; tabIndex++) {
      const tabName = decodeHtml(names[tabIndex]);
      const tabId = positiveInt(tabs.tab_id?.[tabIndex] ?? tabs.tab_id?.[String(tabIndex)]);
      const tabText = decodeHtml(tabs.tab_text?.[tabIndex] ?? tabs.tab_text?.[String(tabIndex)] ?? '');
      const tabsOrder = Number(tabs.tabs_order?.[tabIndex] ?? tabs.tabs_order?.[String(tabIndex)] ?? 1);

      const tabFile = c.fileAccess.getFile([
        'directions',
        instanceIndex,
        'tabs',
        tabIndex,
        'tab_icon_url',
      ]);
      let tabIconUrl = '';
      if (tabFile?.buffer?.length) {
        tabIconUrl = saveTimeBasenameUpload(tabFile, uploadDirTabs) || '';
      }

      if (tabId) {
        const fields = ['tab_name = ?', 'tab_text = ?', 'tabs_order = ?'];
        const params = [tabName, tabText, tabsOrder];
        if (tabIconUrl) {
          fields.push('tab_icon_url = ?');
          params.push(tabIconUrl);
        }
        params.push(tabId);
        await c.pool.query(`UPDATE tabs SET ${fields.join(', ')} WHERE id = ?`, params);
      } else if (tabName) {
        await c.pool.query(
          `INSERT INTO tabs (attached_to_tab, tab_name, tab_text, tab_icon_url, tabs_order)
           VALUES (?, ?, ?, ?, ?)`,
          [directionsId, tabName, tabText, tabIconUrl, tabsOrder]
        );
      }
    }
  }
}

async function savePageBanner(c) {
  const banners = c.body.banner;
  if (!banners || !Object.keys(banners).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;
  const uploadDir = c.getUploadDir('pages_banner');

  for (const instanceIndex of Object.keys(banners)) {
    const bannerData = banners[instanceIndex];
    let bannerId = positiveInt(bannerData.section_id);
    const bgTitle = decodeHtml(bannerData.bg_title ?? '');
    const buttonTitle = decodeHtml(bannerData.button_title ?? '');
    const buttonLink = htmlEscape(bannerData.button_link ?? '');
    const bg_color = bannerData.bg_color ?? '';
    const title_color = checkboxFlag(bannerData, 'title_color');
    const container_full_width = checkboxFlag(bannerData, 'container_full_width');
    const banner_position = bannerData.banner_position ?? 1;
    const sort_order = bannerData.sort_order ?? 1;

    const file = c.fileAccess.getFile(['banner', instanceIndex, 'bg_image']);
    let bgImage = '';
    if (file?.buffer?.length) {
      bgImage = saveTimeBasenameUpload(file, uploadDir) || '';
      if (!bgImage && !bannerId) continue;
    }

    if (bannerId) {
      const setParts = [
        'bg_title = ?',
        'button_title = ?',
        'button_link = ?',
        'bg_color = ?',
        'title_color = ?',
        'container_full_width = ?',
        'banner_position = ?',
      ];
      const params = [
        bgTitle,
        buttonTitle,
        buttonLink,
        bg_color,
        title_color,
        container_full_width,
        banner_position,
      ];
      if (bgImage) {
        setParts.push('bg_image = ?');
        params.push(bgImage);
      }
      params.push(bannerId);
      await c.pool.query(
        `UPDATE pages_banner SET ${setParts.join(', ')} WHERE id = ?`,
        params
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'page_banner',
        sectionId: bannerId,
        sortOrder: sort_order,
      });
    } else if (bgImage) {
      const [ins] = await c.pool.query(
        `INSERT INTO pages_banner (page_id, page_type, bg_title, bg_image, button_title, button_link, bg_color, container_full_width, banner_position, title_color)
         VALUES (?, 'page', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pageId,
          bgTitle,
          bgImage,
          buttonTitle,
          buttonLink,
          bg_color,
          container_full_width,
          banner_position,
          title_color,
        ]
      );
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, 'page', 'page_banner', ?, ?)`,
        [pageId, ins.insertId, sort_order]
      );
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO pages_banner (page_id, page_type, bg_title, button_title, button_link, bg_color, container_full_width, banner_position, title_color)
         VALUES (?, 'page', ?, ?, ?, ?, ?, ?, ?)`,
        [
          pageId,
          bgTitle,
          buttonTitle,
          buttonLink,
          bg_color,
          container_full_width,
          banner_position,
          title_color,
        ]
      );
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, 'page', 'page_banner', ?, ?)`,
        [pageId, ins.insertId, sort_order]
      );
    }
  }
}

async function saveOurExceptional(c) {
  const sections = c.body.exceptional;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;
  const uploadDir = c.getUploadDir('exceptional');

  for (const instanceIndex of Object.keys(sections)) {
    const section = sections[instanceIndex];
    const sectionId = positiveInt(section.section_id);
    const exceptionalTitle = decodeHtml(section.title ?? '');
    const exceptionalSub = decodeHtml(section.subtitle ?? '');
    const buttonTitle = decodeHtml(section.button_title ?? '');
    const buttonLink = htmlEscape(section.button_link ?? '');
    const exceptionalContent = decodeHtml(section.content ?? '');
    const sort_order = section.sort_order ?? 1;

    const file = c.fileAccess.getFile(['exp_image', instanceIndex]);
    let expImage = '';
    if (file?.buffer?.length) {
      expImage = saveTimeBasenameUpload(file, uploadDir) || '';
    }

    if (sectionId) {
      const setParts = [
        'exceptional_title = ?',
        'exceptional_subtitle = ?',
        'button_title = ?',
        'button_link = ?',
        'exceptional_content = ?',
      ];
      const params = [
        exceptionalTitle,
        exceptionalSub,
        buttonTitle,
        buttonLink,
        exceptionalContent,
      ];
      if (expImage) {
        setParts.push('exp_image = ?');
        params.push(expImage);
      }
      params.push(sectionId);
      await c.pool.query(
        `UPDATE our_exceptional SET ${setParts.join(', ')} WHERE id = ?`,
        params
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'our_exceptional',
        sectionId,
        sortOrder: sort_order,
      });
    } else {
      let insertId;
      if (expImage) {
        const [ins] = await c.pool.query(
          `INSERT INTO our_exceptional (page_id, page_type, exceptional_title, exceptional_subtitle, button_title, button_link, exceptional_content, exp_image)
           VALUES (?, 'page', ?, ?, ?, ?, ?, ?)`,
          [
            pageId,
            exceptionalTitle,
            exceptionalSub,
            buttonTitle,
            buttonLink,
            exceptionalContent,
            expImage,
          ]
        );
        insertId = ins.insertId;
      } else {
        const [ins] = await c.pool.query(
          `INSERT INTO our_exceptional (page_id, page_type, exceptional_title, exceptional_subtitle, button_title, button_link, exceptional_content)
           VALUES (?, 'page', ?, ?, ?, ?, ?)`,
          [pageId, exceptionalTitle, exceptionalSub, buttonTitle, buttonLink, exceptionalContent]
        );
        insertId = ins.insertId;
      }
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, 'page', 'our_exceptional', ?, ?)`,
        [pageId, insertId, sort_order]
      );
    }
  }
}

async function saveDynamicContent(c) {
  const sections = c.body.dynamic_content;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;

  for (const instanceIndex of Object.keys(sections)) {
    const section = sections[instanceIndex];
    const sectionTitle = trim(section.title ?? '');
    let sectionId = positiveInt(section.section_id);
    const make_cta = section.make_cta ?? '';
    const sort_order = section.sort_order ?? 1;

    if (sectionId) {
      await c.pool.query(
        `UPDATE dynamic_content_sections SET section_title = ?, make_cta = ? WHERE id = ?`,
        [sectionTitle, make_cta, sectionId]
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'dynamic_content',
        sectionId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO dynamic_content_sections (page_id, page_type, section_title, make_cta)
         VALUES (?, ?, ?, ?)`,
        [pageId, c.dataType, sectionTitle, make_cta]
      );
      sectionId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, ?, 'dynamic_content', ?, ?)`,
        [pageId, c.dataType, sectionId, sort_order]
      );
    }

    const items = section.items;
    if (!items) continue;

    for (const index of Object.keys(items)) {
      const item = items[index];
      if (!item?.type) continue;

      const itemId = positiveInt(item.item_id);
      const itemType = item.type;
      let itemContent = '';
      let itemTitle = '';
      let itemUrl = '';
      let itemImage = '';

      const file = c.fileAccess.getFile([
        'dynamic_content',
        instanceIndex,
        'items',
        index,
        'image',
      ]);
      if (itemType === 'image' && file?.buffer?.length) {
        const uploadDir = c.getUploadDir('dynamic_content');
        itemImage = saveTimeBasenameUpload(file, uploadDir) || '';
        itemTitle = item.alt_text ?? '';
      } else if (itemType === 'image' && item.alt_text) {
        itemTitle = item.alt_text ?? '';
      } else if (itemType === 'text') {
        itemContent = trim(item.text_content ?? '');
      } else if (itemType === 'link') {
        itemTitle = trim(item.link_title ?? '');
        itemUrl = trim(item.link_url ?? '');
      }

      if (itemId) {
        const updateFields = [
          'item_type = ?',
          'item_title = ?',
          'item_content = ?',
          'item_url = ?',
          'sort_order = ?',
        ];
        const params = [itemType, itemTitle, itemContent, itemUrl, Number(index)];
        if (itemImage) {
          updateFields.push('item_image = ?');
          params.push(itemImage);
        }
        params.push(itemId);
        await c.pool.query(
          `UPDATE dynamic_content_items SET ${updateFields.join(', ')} WHERE id = ?`,
          params
        );
      } else {
        await c.pool.query(
          `INSERT INTO dynamic_content_items (section_id, item_type, item_title, item_content, item_url, item_image, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [sectionId, itemType, itemTitle, itemContent, itemUrl, itemImage, Number(index)]
        );
      }
    }
  }
}

async function saveInfoCard(c) {
  const sections = c.body.info_card;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;

  for (const instanceIndex of Object.keys(sections)) {
    const section = sections[instanceIndex];
    const bgColor = trim(section.bg_color ?? '');
    let sectionId = positiveInt(section.section_id);
    const sort_order = Number(section.sort_order) || 1;

    if (sectionId) {
      await c.pool.query(`UPDATE info_card_section SET bg_color = ? WHERE id = ?`, [
        bgColor,
        sectionId,
      ]);
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'info_card',
        sectionId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO info_card_section (page_id, bg_color, sort_order) VALUES (?, ?, ?)`,
        [pageId, bgColor, 1]
      );
      sectionId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, ?, 'info_card', ?, ?)`,
        [pageId, c.dataType, sectionId, sort_order]
      );
    }

    const cards = section.cards;
    if (!cards) continue;

    for (const index of Object.keys(cards)) {
      const card = cards[index];
      const cardId = positiveInt(card.card_id);
      const cardTitle = trim(card.card_title ?? '');
      const cardText = trim(card.card_text ?? '');
      const sortOrder = Number(card.sort_order) || Number(index) + 1;

      const file = c.fileAccess.getFile([
        'info_card',
        instanceIndex,
        'cards',
        index,
        'card_icon',
      ]);
      let cardIcon = '';
      if (file?.buffer?.length) {
        const uploadDir = c.getUploadDir('info_cards');
        cardIcon = saveTimeBasenameUpload(file, uploadDir) || '';
      }

      if (cardId) {
        const updateFields = ['card_title = ?', 'card_text = ?', 'sort_order = ?'];
        const params = [cardTitle, cardText, sortOrder];
        if (cardIcon) {
          const [oldRows] = await c.pool.query(
            `SELECT card_icon FROM info_card_data WHERE id = ?`,
            [cardId]
          );
          const oldIcon = oldRows?.[0]?.card_icon;
          if (oldIcon) {
            const oldPath = path.join(c.getUploadDir('info_cards'), oldIcon);
            try {
              if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            } catch {
              /* ignore */
            }
          }
          updateFields.push('card_icon = ?');
          params.push(cardIcon);
        }
        params.push(cardId);
        await c.pool.query(
          `UPDATE info_card_data SET ${updateFields.join(', ')} WHERE id = ?`,
          params
        );
      } else {
        await c.pool.query(
          `INSERT INTO info_card_data (card_title, card_text, card_icon, attached_to_card, sort_order)
           VALUES (?, ?, ?, ?, ?)`,
          [cardTitle, cardText, cardIcon, sectionId, sortOrder]
        );
      }
    }
  }
}

async function savePriceCard(c) {
  const sections = c.body.price_card;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;

  for (const instanceIndex of Object.keys(sections)) {
    const section = sections[instanceIndex];
    const sectionTitle = trim(section.title ?? '');
    const note = trim(section.note ?? '');
    const bottomText = trim(section.bottom_text ?? '');
    let sectionId = positiveInt(section.section_id);
    const sort_order = Number(section.sort_order) || 1;

    if (sectionId) {
      await c.pool.query(
        `UPDATE price_card_sections SET title = ?, note = ?, bottom_text = ? WHERE id = ?`,
        [sectionTitle, note, bottomText, sectionId]
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'price_card',
        sectionId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO price_card_sections (title, note, bottom_text, page_id) VALUES (?, ?, ?, ?)`,
        [sectionTitle, note, bottomText, pageId]
      );
      sectionId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, ?, 'price_card', ?, ?)`,
        [pageId, c.dataType, sectionId, sort_order]
      );
    }

    const cards = section.cards;
    if (!cards) continue;

    for (const index of Object.keys(cards)) {
      const card = cards[index];
      const cardId = positiveInt(card.card_id);
      const markerText = trim(card.marker_text ?? '');
      const title = trim(card.title ?? '');
      const packageTime = trim(card.package_time ?? '');
      const price = card.price ?? '';
      const packageContent = trim(card.package_content ?? '');
      const noteText = trim(card.note_text ?? '');
      const buttonText = trim(card.button_text ?? '');
      const buttonUrl = trim(card.button_url ?? '');
      const sortOrder = Number(card.sort_order) || Number(index) + 1;

      if (cardId) {
        await c.pool.query(
          `UPDATE price_card_data SET marker_text = ?, title = ?, package_time = ?, price = ?, package_content = ?, note_text = ?, button_text = ?, button_url = ?, sort_order = ? WHERE id = ?`,
          [
            markerText,
            title,
            packageTime,
            price,
            packageContent,
            noteText,
            buttonText,
            buttonUrl,
            sortOrder,
            cardId,
          ]
        );
      } else {
        await c.pool.query(
          `INSERT INTO price_card_data (marker_text, title, package_time, price, package_content, note_text, button_text, button_url, attached_price_card, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            markerText,
            title,
            packageTime,
            price,
            packageContent,
            noteText,
            buttonText,
            buttonUrl,
            sectionId,
            sortOrder,
          ]
        );
      }
    }
  }
}

async function saveAccordion(c) {
  const sections = c.body.accordion;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;

  for (const instanceIndex of Object.keys(sections)) {
    const section = sections[instanceIndex];
    const header = trim(section.header_txt ?? '');
    let sectionId = positiveInt(section.section_id);
    const sort_order = Number(section.sort_order) || 1;

    if (sectionId) {
      await c.pool.query(
        `UPDATE accordion_section SET header_txt = ?, sort_order = ? WHERE id = ?`,
        [header, sort_order, sectionId]
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'accordion',
        sectionId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO accordion_section (header_txt, page_id, sort_order) VALUES (?, ?, ?)`,
        [header, pageId, sort_order]
      );
      sectionId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id) VALUES (?, ?, 'accordion', ?)`,
        [pageId, c.dataType, sectionId]
      );
    }

    const items = section.items;
    if (!items) continue;

    for (const index of Object.keys(items)) {
      const item = items[index];
      const itemId = positiveInt(item.item_id);
      const title = trim(item.accordion_title ?? '');
      const text = trim(item.accordion_text ?? '');
      const sortOrder = Number(item.sort_order) || Number(index) + 1;

      if (itemId) {
        await c.pool.query(
          `UPDATE accordion_sec_data SET accordion_title = ?, accordion_text = ?, sort_order = ? WHERE id = ?`,
          [title, text, sortOrder, itemId]
        );
      } else {
        await c.pool.query(
          `INSERT INTO accordion_sec_data (accordion_title, accordion_text, ref_accordion, sort_order)
           VALUES (?, ?, ?, ?)`,
          [title, text, sectionId, sortOrder]
        );
      }
    }
  }
}

async function saveContentCards(c) {
  const sections = c.body.content_cards;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;

  for (const instanceIndex of Object.keys(sections)) {
    const section = sections[instanceIndex];
    const contentText = trim(section.content_text ?? '');
    let sectionId = positiveInt(section.section_id);
    const sort_order = Number(section.sort_order) || 1;

    if (sectionId) {
      await c.pool.query(
        `UPDATE content_cards_section SET content_text = ? WHERE id = ?`,
        [contentText, sectionId]
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'content_cards',
        sectionId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO content_cards_section (content_text, page_id) VALUES (?, ?)`,
        [contentText, pageId]
      );
      sectionId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, ?, 'content_cards', ?, ?)`,
        [pageId, c.dataType, sectionId, sort_order]
      );
    }

    const items = section.items;
    if (!items) continue;

    for (const index of Object.keys(items)) {
      const item = items[index];
      const itemId = positiveInt(item.item_id);
      const title = trim(item.item_title ?? '');
      const text = trim(item.item_text ?? '');
      const redBtnTxt = trim(item.red_btn_txt ?? '');
      const redBtnUrl = trim(item.red_btn_url ?? '');
      const blueBtnTxt = trim(item.blue_btn_txt ?? '');
      const blueBtnUrl = trim(item.blue_btn_url ?? '');
      const markerText = trim(item.marker_text ?? '');
      const sortOrder = Number(item.sort_order) || Number(index) + 1;

      const file = c.fileAccess.getFile([
        'content_cards',
        instanceIndex,
        'items',
        index,
        'item_img_uri',
      ]);
      let cardIcon = '';
      if (file?.buffer?.length) {
        cardIcon = saveTimeBasenameUpload(file, c.getUploadDir('content_cards')) || '';
      }

      if (itemId) {
        if (cardIcon) {
          await c.pool.query(
            `UPDATE content_cards_items SET item_img_uri = ?, item_title = ?, item_text = ?, red_btn_txt = ?, red_btn_url = ?, blue_btn_txt = ?, blue_btn_url = ?, marker_text = ?, sort_order = ? WHERE id = ?`,
            [
              cardIcon,
              title,
              text,
              redBtnTxt,
              redBtnUrl,
              blueBtnTxt,
              blueBtnUrl,
              markerText,
              sortOrder,
              itemId,
            ]
          );
        } else {
          await c.pool.query(
            `UPDATE content_cards_items SET item_title = ?, item_text = ?, red_btn_txt = ?, red_btn_url = ?, blue_btn_txt = ?, blue_btn_url = ?, marker_text = ?, sort_order = ? WHERE id = ?`,
            [
              title,
              text,
              redBtnTxt,
              redBtnUrl,
              blueBtnTxt,
              blueBtnUrl,
              markerText,
              sortOrder,
              itemId,
            ]
          );
        }
      } else {
        await c.pool.query(
          `INSERT INTO content_cards_items (item_img_uri, item_title, item_text, red_btn_txt, red_btn_url, blue_btn_txt, blue_btn_url, marker_text, ref_content_card, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cardIcon,
            title,
            text,
            redBtnTxt,
            redBtnUrl,
            blueBtnTxt,
            blueBtnUrl,
            markerText,
            sectionId,
            sortOrder,
          ]
        );
      }
    }
  }
}

async function saveProcessSteps(c) {
  const sections = c.body.process_steps;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;

  for (const instanceIndex of Object.keys(sections)) {
    const section = sections[instanceIndex];
    const sectionTitle = trim(section.process_step_title ?? '');
    let sectionId = positiveInt(section.section_id);
    const sort_order = Number(section.sort_order) || 1;

    if (sectionId) {
      await c.pool.query(
        `UPDATE process_steps SET process_step_title = ?, sort_order = ? WHERE id = ?`,
        [sectionTitle, sort_order, sectionId]
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'process_steps',
        sectionId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO process_steps (process_step_title, page_id, sort_order) VALUES (?, ?, ?)`,
        [sectionTitle, pageId, sort_order]
      );
      sectionId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, ?, 'process_steps', ?, ?)`,
        [pageId, c.dataType, sectionId, sort_order]
      );
    }

    const items = section.items;
    if (!items) continue;

    for (const index of Object.keys(items)) {
      const item = items[index];
      const itemId = positiveInt(item.item_id);
      const stepNo = trim(item.step_no ?? '');
      const stepTitle = trim(item.step_title ?? '');
      const stepDescription = trim(item.step_description ?? '');
      const sortOrder = Number(item.sort_order) || Number(index) + 1;

      if (itemId) {
        await c.pool.query(
          `UPDATE process_step_content SET step_no = ?, step_title = ?, step_description = ?, sort_order = ? WHERE id = ?`,
          [stepNo, stepTitle, stepDescription, sortOrder, itemId]
        );
      } else {
        await c.pool.query(
          `INSERT INTO process_step_content (step_no, step_title, step_description, sort_order, main_process_ref)
           VALUES (?, ?, ?, ?, ?)`,
          [stepNo, stepTitle, stepDescription, sortOrder, sectionId]
        );
      }
    }
  }
}

async function saveServiceAreas(c) {
  const sections = c.body.service_areas;
  if (!sections || !Object.keys(sections).length) return;

  const pageId = positiveInt(c.body.page_id) || c.pageId;

  for (const instanceIndex of Object.keys(sections)) {
    const section = sections[instanceIndex];
    const border = checkboxFlag(section, 'border');
    const showBg = checkboxFlag(section, 'show_bg');
    const bulletType = section.bullet_type ?? 'check';
    let sectionId = positiveInt(section.section_id);
    const sort_order = Number(section.sort_order) || 1;

    if (sectionId) {
      await c.pool.query(
        `UPDATE service_areas_section SET border = ?, show_bg = ?, bullet_type = ? WHERE id = ?`,
        [border, showBg, bulletType, sectionId]
      );
      await upsertJunction(c.pool, {
        dataId: pageId,
        dataType: c.dataType,
        sectionData: 'service_areas',
        sectionId,
        sortOrder: sort_order,
      });
    } else {
      const [ins] = await c.pool.query(
        `INSERT INTO service_areas_section (border, show_bg, bullet_type, page_id)
         VALUES (?, ?, ?, ?)`,
        [border, showBg, bulletType, pageId]
      );
      sectionId = ins.insertId;
      await c.pool.query(
        `INSERT INTO page_junction (data_id, data_type, section_data, section_id, sort_order)
         VALUES (?, ?, 'service_areas', ?, ?)`,
        [pageId, c.dataType, sectionId, sort_order]
      );
    }

    const dataRows = section.data;
    if (!dataRows) continue;

    for (const index of Object.keys(dataRows)) {
      const data = dataRows[index];
      const dataId = positiveInt(data.data_id);
      const leftText = trim(data.left_text ?? '');
      const rightText = trim(data.right_text ?? '');
      const sortOrder = Number(index) + 1;

      if (dataId) {
        await c.pool.query(
          `UPDATE service_areas_data SET left_text = ?, right_text = ?, sort_order = ? WHERE id = ?`,
          [leftText, rightText, sortOrder, dataId]
        );
      } else {
        await c.pool.query(
          `INSERT INTO service_areas_data (left_text, right_text, attached_to_service, sort_order)
           VALUES (?, ?, ?, ?)`,
          [leftText, rightText, sectionId, sortOrder]
        );
      }
    }
  }
}

const SECTION_SAVE_HANDLERS = [
  ['home_slider', saveHomeSlider],
  ['direct_access', saveDirectAccess],
  ['our_services', saveOurServices],
  ['cheap_cbt_test_across_london', saveCbtAcrossLondon],
  ['cheap_cbt_test_london', saveCbtTestLondon],
  ['cms_sidebar', saveCmsSidebar],
  ['expert_training', saveExpertTraining],
  ['why_1stop', saveWhy1stop],
  ['directions_parking', saveDirectionsParking],
  ['page_banner', savePageBanner],
  ['our_exceptional', saveOurExceptional],
  ['dynamic_content', saveDynamicContent],
  ['info_card', saveInfoCard],
  ['price_card', savePriceCard],
  ['accordion', saveAccordion],
  ['content_cards', saveContentCards],
  ['process_steps', saveProcessSteps],
  ['service_areas', saveServiceAreas],
];

async function saveAllSections(pool, options) {
  const c = ctx(
    pool,
    options.pageId,
    options.dataType || 'page',
    options.body || {},
    options.files || [],
    options.getUploadDir
  );

  for (const [, handler] of SECTION_SAVE_HANDLERS) {
    await handler(c);
  }
}

module.exports = {
  saveAllSections,
  SECTION_SAVE_HANDLERS,
};
