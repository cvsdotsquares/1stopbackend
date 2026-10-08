/**
 * Port of remove_page_slider_section.php and related remove endpoints.
 */
async function removePageSection(pool, { pageId, pageType = 'page', slider_type, section_id = 0 }) {
  const pid = Number(pageId);
  const sid = Number(section_id) || 0;
  const type = String(slider_type || '');

  if (!pid || !type) {
    return { ok: false, message: 'Invalid request' };
  }

  if (type === 'home_slider') {
    await pool.query('DELETE FROM pageSliders WHERE page_id = ? AND page_type = ?', [
      pid,
      pageType,
    ]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, pageType, type]
    );
  } else if (type === 'direct_access') {
    await pool.query('DELETE FROM direct_access WHERE page_id = ? AND id = ? AND page_type = ?', [
      pid,
      sid,
      pageType,
    ]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'our_services') {
    await pool.query('DELETE FROM our_services WHERE page_id = ? AND page_type = ? AND id = ?', [
      pid,
      pageType,
      sid,
    ]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'cheap_cbt_test_across_london') {
    await pool.query('DELETE FROM cbt_across_london WHERE page_id = ? AND page_type = ? AND id = ?', [
      pid,
      pageType,
      sid,
    ]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'cheap_cbt_test_london') {
    await pool.query('DELETE FROM cbt_test_london WHERE page_id = ? AND page_type = ? AND id = ?', [
      pid,
      pageType,
      sid,
    ]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'expert_training') {
    await pool.query(
      'DELETE FROM expert_training_slider WHERE page_id = ? AND page_type = ? AND id = ?',
      [pid, pageType, sid]
    );
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'why_1stop') {
    await pool.query('DELETE FROM why_1stop WHERE page_id = ? AND page_type = ? AND id = ?', [
      pid,
      pageType,
      sid,
    ]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'our_exceptional') {
    await pool.query('DELETE FROM our_exceptional WHERE page_id = ? AND page_type = ? AND id = ?', [
      pid,
      pageType,
      sid,
    ]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'page_banner') {
    await pool.query('DELETE FROM pages_banner WHERE page_id = ? AND page_type = ? AND id = ?', [
      pid,
      pageType,
      sid,
    ]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'dynamic_content') {
    await pool.query(
      'DELETE FROM dynamic_content_sections WHERE page_id = ? AND page_type = ? AND id = ?',
      [pid, pageType, sid]
    );
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'info_card') {
    await pool.query(
      `DELETE FROM info_card_data WHERE attached_to_card IN (SELECT id FROM info_card_section WHERE page_id = ? AND id = ?)`,
      [pid, sid]
    );
    await pool.query('DELETE FROM info_card_section WHERE page_id = ? AND id = ?', [pid, sid]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'price_card') {
    await pool.query(
      `DELETE FROM price_card_data WHERE attached_price_card IN (SELECT id FROM price_card_sections WHERE page_id = ? AND id = ?)`,
      [pid, sid]
    );
    await pool.query('DELETE FROM price_card_sections WHERE page_id = ? AND id = ?', [pid, sid]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'service_areas') {
    await pool.query(
      `DELETE FROM service_areas_data WHERE attached_to_service IN (SELECT id FROM service_areas_section WHERE page_id = ? AND id = ?)`,
      [pid, sid]
    );
    await pool.query('DELETE FROM service_areas_section WHERE page_id = ? AND id = ?', [pid, sid]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'content_cards') {
    await pool.query(
      `DELETE FROM content_cards_items WHERE ref_content_card IN (SELECT id FROM content_cards_section WHERE page_id = ? AND id = ?)`,
      [pid, sid]
    );
    await pool.query('DELETE FROM content_cards_section WHERE page_id = ? AND id = ?', [pid, sid]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'cms_sidebar') {
    await pool.query('DELETE FROM cms_sidebar WHERE page_id = ?', [pid]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, pageType, type]
    );
  } else if (type === 'process_steps') {
    await pool.query(
      `DELETE FROM process_step_content WHERE main_process_ref IN (SELECT id FROM process_steps WHERE page_id = ? AND id = ?)`,
      [pid, sid]
    );
    await pool.query('DELETE FROM process_steps WHERE page_id = ? AND id = ?', [pid, sid]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'directions_parking') {
    await pool.query(
      `DELETE FROM tabs WHERE attached_to_tab IN (SELECT id FROM tab_section WHERE page_id = ? AND id = ?)`,
      [pid, sid]
    );
    await pool.query('DELETE FROM tab_section WHERE page_id = ? AND id = ?', [pid, sid]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else if (type === 'accordion') {
    await pool.query(
      `DELETE FROM accordion_sec_data WHERE ref_accordion IN (SELECT id FROM accordion_section WHERE page_id = ? AND id = ?)`,
      [pid, sid]
    );
    await pool.query('DELETE FROM accordion_section WHERE page_id = ? AND id = ?', [pid, sid]);
    await pool.query(
      `DELETE FROM page_junction WHERE data_id = ? AND section_id = ? AND data_type = ? AND section_data = ? LIMIT 1`,
      [pid, sid, pageType, type]
    );
  } else {
    return { ok: false, message: 'Invalid slider type' };
  }

  return { ok: true };
}

async function removeSectionItem(pool, { sectiontype, section_id, itemid }) {
  const sid = Number(section_id);
  const iid = Number(itemid);
  const type = String(sectiontype || '');

  if (!sid || !iid || !type) {
    return { ok: false, message: 'Invalid request' };
  }

  if (type === 'content_cards') {
    await pool.query('DELETE FROM content_cards_items WHERE id = ? AND ref_content_card = ?', [
      iid,
      sid,
    ]);
  } else if (type === 'accordion') {
    await pool.query('DELETE FROM accordion_sec_data WHERE id = ? AND ref_accordion = ?', [
      iid,
      sid,
    ]);
  } else if (type === 'info_card') {
    await pool.query('DELETE FROM info_card_data WHERE id = ? AND attached_to_card = ?', [
      iid,
      sid,
    ]);
  } else if (type === 'dynamic_content') {
    await pool.query('DELETE FROM dynamic_content_items WHERE id = ? AND section_id = ?', [
      iid,
      sid,
    ]);
  } else if (type === 'process_steps') {
    await pool.query('DELETE FROM process_step_content WHERE id = ? AND main_process_ref = ?', [
      iid,
      sid,
    ]);
  } else if (type === 'service_areas') {
    await pool.query('DELETE FROM service_areas_data WHERE id = ? AND attached_to_service = ?', [
      iid,
      sid,
    ]);
  } else if (type === 'price_card') {
    await pool.query('DELETE FROM price_card_data WHERE id = ? AND attached_price_card = ?', [
      iid,
      sid,
    ]);
  } else if (type === 'direct_access_image') {
    await pool.query('DELETE FROM direct_access_image WHERE id = ? AND direct_access_id = ?', [
      iid,
      sid,
    ]);
  } else if (type === 'our_services') {
    await pool.query('DELETE FROM service_images WHERE id = ? AND service_id = ?', [iid, sid]);
  } else {
    return { ok: false, message: 'Invalid section type' };
  }

  return { ok: true };
}

async function updateSectionSortOrder(pool, { page_id, section_type, sort_order, sectionId, page_type = 'page' }) {
  const pid = Number(page_id);
  const order = Number(sort_order) || 1;
  const sid = Number(sectionId);
  const st = String(section_type || '');

  if (!pid || !st) {
    return { ok: false, message: 'Invalid parameters' };
  }

  await pool.query(
    `UPDATE page_junction SET sort_order = ?
     WHERE data_id = ? AND data_type = ? AND section_data = ? AND section_id = ?`,
    [order, pid, page_type, st, sid]
  );

  return { ok: true, message: 'Sort order updated successfully' };
}

module.exports = {
  removePageSection,
  removeSectionItem,
  updateSectionSortOrder,
};
