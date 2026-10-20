const customersService = require('../services/customersService');
const vehiclesService = require('../services/vehiclesService');

function trim(value) {
  return value == null ? '' : String(value).trim();
}

async function quickSearch(pool, req, res) {
  try {
    const q = trim(req.query.q);
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 5));

    if (!q) {
      return res.json({
        success: true,
        ok: true,
        data: {
          query: '',
          customers: [],
          contacts: [],
          vehicles: [],
          totalCustomers: 0,
          totalContacts: 0,
          totalVehicles: 0,
        },
      });
    }

    const [attendingResult, contactsResult, vehiclesResult] = await Promise.all([
      customersService.listAttendingCustomers(pool, {
        searchterm: { name_scr: q },
        page: 1,
        limit,
      }),
      customersService.listContactCards(pool, {
        searchterm: { name_scr: q },
        page: 1,
        limit,
      }),
      vehiclesService.listVehicles(pool, {
        name_scr: q,
        page: 1,
        limit,
      }),
    ]);

    const formattedCustomers = (attendingResult.items || []).slice(0, limit).map((c) => ({
      attendee_id: c.attendee_id,
      booking_id: c.booking_id,
      booking_ref: c.booking_ref,
      attendee_name: c.attendee_name,
      course_abb: c.course_abb,
      course_date: c.course_date,
      email: c.email,
      contact1: c.contact1,
      on_hold: c.on_hold,
      type: 'attending',
    }));

    const formattedContacts = (contactsResult.items || []).slice(0, limit).map((c) => ({
      id: c.id,
      booking_id: c.booking_id,
      booking_ref: c.booking_ref,
      attendee_name: c.full_name || `${c.first_name} ${c.sur_name}`.trim(),
      email: c.email,
      contact1: c.contact1,
      license_number: c.license_number,
      type: 'contact_card',
    }));

    const formattedVehicles = (vehiclesResult.items || []).slice(0, limit).map((v) => ({
      id: v.id,
      registration: v.registration,
      make_model: v.make_model,
      engine_size: v.engine_size,
      transmission: v.transmission,
      loc_abb: v.loc_abb,
      location_name: v.location_name,
    }));

    return res.json({
      success: true,
      ok: true,
      data: {
        query: q,
        customers: formattedCustomers,
        contacts: formattedContacts,
        vehicles: formattedVehicles,
        totalCustomers: attendingResult.pagination?.total || 0,
        totalContacts: contactsResult.pagination?.total || 0,
        totalVehicles: vehiclesResult.pagination?.total || 0,
      },
    });
  } catch (err) {
    console.error('Quick search error:', err);
    return res.status(500).json({
      success: false,
      ok: false,
      message: 'Failed to perform quick search',
      error: err.message,
    });
  }
}

async function globalSearch(pool, req, res) {
  try {
    const q = trim(req.query.q);
    const type = trim(req.query.type) || 'all';
    const pageCustomers = Math.max(1, Number(req.query.page_customers) || 1);
    const pageContacts = Math.max(1, Number(req.query.page_contacts) || 1);
    const pageVehicles = Math.max(1, Number(req.query.page_vehicles) || 1);
    const limitCustomers = Math.min(50, Math.max(1, Number(req.query.limit_customers) || 10));
    const limitContacts = Math.min(50, Math.max(1, Number(req.query.limit_contacts) || 10));
    const limitVehicles = Math.min(50, Math.max(1, Number(req.query.limit_vehicles) || 10));

    const shouldSearchCustomers = type === 'all' || type === 'customers';
    const shouldSearchVehicles = type === 'all' || type === 'vehicles';

    const [attendingResult, contactsResult, vehiclesResult] = await Promise.all([
      shouldSearchCustomers
        ? customersService.listAttendingCustomers(pool, {
            searchterm: { name_scr: q },
            page: pageCustomers,
            limit: limitCustomers,
          })
        : {
            items: [],
            pagination: { page: pageCustomers, perPage: limitCustomers, total: 0, totalPages: 1 },
            filters: { name_scr: q },
          },
      shouldSearchCustomers
        ? customersService.listContactCards(pool, {
            searchterm: { name_scr: q },
            page: pageContacts,
            limit: limitContacts,
          })
        : {
            items: [],
            pagination: { page: pageContacts, perPage: limitContacts, total: 0, totalPages: 1 },
            filters: { name_scr: q },
          },
      shouldSearchVehicles
        ? vehiclesService.listVehicles(pool, {
            name_scr: q,
            page: pageVehicles,
            limit: limitVehicles,
          })
        : {
            items: [],
            pagination: { page: pageVehicles, perPage: limitVehicles, total: 0, totalPages: 1 },
            filters: { name_scr: q },
          },
    ]);

    return res.json({
      success: true,
      ok: true,
      data: {
        query: q,
        type,
        customers: attendingResult,
        contacts: contactsResult,
        vehicles: vehiclesResult,
      },
    });
  } catch (err) {
    console.error('Global search error:', err);
    return res.status(500).json({
      success: false,
      ok: false,
      message: 'Failed to perform search',
      error: err.message,
    });
  }
}

module.exports = {
  quickSearch,
  globalSearch,
};
