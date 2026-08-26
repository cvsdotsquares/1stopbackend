function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatGBP(amount = 0) {
  return `£${Number(amount || 0).toFixed(2)}`;
}

function formatDateDDMMYY(dateStr) {
  if (!dateStr) return 'TBC';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900) return 'TBC';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function formatTime12h(timeStr) {
  if (!timeStr) return 'TBC';
  const [h = '00', m = '00'] = String(timeStr).split(':');
  const dt = new Date();
  dt.setHours(Number(h), Number(m), 0, 0);
  return dt.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

function minus15mins(timeStr) {
  if (!timeStr) return 'TBC';
  const [h = '00', m = '00'] = String(timeStr).split(':');
  const dt = new Date();
  dt.setHours(Number(h), Number(m), 0, 0);
  dt.setMinutes(dt.getMinutes() - 15);
  return dt.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

function normalizeUrl(url, fallback = '#') {
  const value = String(url || '').trim();
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value)) return value.replace(/^http:\/\//i, 'https://');
  return `https://${value}`;
}

function buildSubject(data) {
  return `${data.course_name || 'Course'} Booking Confirmation`;
}

function buildPupilName(data) {
  const firstName = String(data.first_name || '').trim();
  const surname = String(data.sur_name || '').trim();
  const rideToRef = String(data.rideto_ref || '').trim();
  const baseName = `${firstName} ${surname}`.replace(/\s+/g, ' ').trim();

  if (!rideToRef || baseName.includes(rideToRef)) return baseName;
  return `${baseName} (${rideToRef})`.trim();
}

function buildDateRows(eventDates = []) {
  if (!eventDates.length) {
    return '<tr><td>TBC</td><td>TBC</td><td>TBC</td></tr>';
  }

  return eventDates
    .map((dt) => {
      if (!dt?.event_date || dt.event_date === '0000-00-00' || dt.event_date === '1111-11-11') {
        return '<tr><td>TBC</td><td>TBC</td><td>TBC</td></tr>';
      }

      return `
        <tr>
          <td>${escapeHtml(formatDateDDMMYY(dt.event_date))}</td>
          <td><span class="aQJ">${escapeHtml(minus15mins(dt.event_start_time))}</span></td>
          <td><span class="aQJ">${escapeHtml(formatTime12h(dt.event_start_time))}</span></td>
        </tr>
      `;
    })
    .join('');
}

function buildBookingConfirmationHtml(data) {
  const paymentReceived = Number(data.total_amount || 0) - Number(data.payment_due || 0);
  const pupilName = buildPupilName(data);
  const eventRows = buildDateRows(data.eventDates || []);
  const websiteUrl = normalizeUrl(data.website_url || data.site_url, data.site_url || '#');
  const contactUrl = data.contactus_url || `${data.site_url || ''}/contactus`;
  const termsUrl = data.terms_url || `${data.site_url || ''}/terms-and-conditions`;

  return `<!Doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
    <title>1stopinstruction.com</title>
  </head>
  <body style="margin:0; padding:0;">
    <div align="center">
      <table width="800" border="0" align="center" style="background:#f5f5f5 none repeat scroll 0 0;border:1px solid #e0e0e0;padding:5px;">
        <tbody>
          <tr>
            <td class="header">
              <img src="${escapeHtml(data.email_header_url)}" width="784" height="177" alt="1stopinstruction" style="display:block;border:0;outline:none;text-decoration:none;"/>
            </td>
          </tr>
          <tr>
            <td class="content">
              <table width="100%" border="0" style="background:#ffffff none repeat scroll 0 0;padding:10px;margin:0;">
                <tbody>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif;text-align:right;">
                      <strong>Booking Ref</strong>: ${escapeHtml(data.booking_ref)} - ${escapeHtml(data.booking_type)}
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif;">
                      Dear ${escapeHtml(data.first_name || 'Customer')},
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif;">
                      <p>Thank you for booking your ${escapeHtml(data.course_name)} Course with 1 Stop Instruction.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif;">
                      <p style="margin-top:0;">Please note your booking confirmation details below:</p>
                      <table cellspacing="0" cellpadding="0" border="0" width="99%" style="width:99.0%;">
                        <tbody>
                          <tr style="height:48.75pt;">
                            <td width="9%" style="width:9.0%;padding:0;height:48.75pt;">
                              <p class="MsoNormal"><b><span style="font-size:9.0pt;font-family:Arial,sans-serif;color:black;">Name:</span><br>
                                <span style="font-size:9.0pt;font-family:Arial,sans-serif;color:black;">Course:</span><br>
                                <span style="font-size:9.0pt;font-family:Arial,sans-serif;color:black;">Vehicle:</span></b></p>
                            </td>
                            <td width="56%" style="width:56.0%;padding:0;height:48.75pt;">
                              <p class="MsoNormal"><span style="font-size:9.0pt;font-family:Arial,sans-serif;">${escapeHtml(pupilName)}</span><br>
                                <span style="font-size:9.0pt;font-family:Arial,sans-serif;">${escapeHtml(data.course_name || '')}</span><br>
                                <span style="font-size:9.0pt;font-family:Arial,sans-serif;">${escapeHtml(data.vehicle_type_label || '')}</span></p>
                            </td>
                            <td width="20%" style="width:20.0%;padding:0;height:48.75pt;">
                              <p class="MsoNormal"><strong><span style="font-size:9.0pt;font-family:Arial,sans-serif;color:black;">Payment Received:</span></strong><br>
                                <strong><span style="font-size:9.0pt;font-family:Arial,sans-serif;color:black;">Balance Outstanding:</span></strong></p>
                            </td>
                            <td width="12%" style="text-align:right;width:12.0%;padding:0;height:48.75pt;">
                              <p class="MsoNormal"><span style="color:black;">${formatGBP(paymentReceived)}<br>${formatGBP(data.payment_due)}</span></p>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif;">
                      <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                          <td width="60%" valign="top">
                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                              <tr><td><strong><u>Course Location</u></strong></td></tr>
                              <tr>
                                <td>
                                  ${data.location_name ? `${escapeHtml(data.location_name)}<br>` : ''}
                                  ${data.address1 ? `${escapeHtml(data.address1)}<br>` : ''}
                                  ${data.address2 ? `${escapeHtml(data.address2)}<br>` : ''}
                                  ${data.address3 ? `${escapeHtml(data.address3)}<br>` : ''}
                                  ${data.address4 ? `${escapeHtml(data.address4)}<br>` : ''}
                                  ${escapeHtml(data.postcode || '')}
                                </td>
                              </tr>
                            </table>
                          </td>
                          <td align="right" valign="top">
                            <table width="98%" border="0" cellspacing="0" cellpadding="0">
                              <tr>
                                <td width="24%"><strong><u>Date</u></strong></td>
                                <td width="36%"><strong><u>Meeting Time</u></strong></td>
                                <td width="33%"><strong><u>Start Time</u></strong></td>
                              </tr>
                              ${eventRows}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="font-size:9.0pt;font-family:Arial,sans-serif;">
                      ${data.email_content_html || ''}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-family:Arial;font-size:12px;">
                        <tr>
                          <td width="50%" height="20" valign="top"><b>Directions</b></td>
                          <td width="50%" rowspan="2" align="center" valign="top"><b>Map of Location</b><br></td>
                        </tr>
                        <tr>
                          <td colspan="2" valign="top" style="text-align:left;">
                            <img src="${escapeHtml(data.direction_map_url || data.no_map_url || '')}" width="350" style="display:block;border:0;outline:none;text-decoration:none;float:right;margin:10px 0 10px 10px;" alt="Direction Map"/>
                            ${data.direction_content_html || ''}
                          </td>
                        </tr>
                        <tr>
                          <td colspan="2">Finally, we trust that all the information you require is listed in this email, and we hope that you enjoy your course, but should you have any questions in the meantime, please do not hesitate to contact us.</td>
                        </tr>
                        <tr><td style="color:#ff6600;"> </td><td> </td></tr>
                        <tr><td style="color:black;">Kind Regards,</td><td> </td></tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <table width="100%" border="0">
                        <tbody>
                          <tr>
                            <td>
                              <p class="MsoNormal" style="margin:10px 0;font-family:Arial;"><span><b><i><span style="font-size:13.5pt;">1 Stop Instruction</span></i></b></span></p>
                            </td>
                          </tr>
                          <tr>
                            <td>
                              <table cellspacing="0" cellpadding="0" border="0" width="99%" style="width:99.0%;">
                                <tbody>
                                  <tr>
                                    <td align="left" valign="middle">
                                      <a href="${escapeHtml(websiteUrl)}"><img src="${escapeHtml(data.email_logo_url)}" width="90" alt="1stopinstruction" style="display:block;border:0;outline:none;text-decoration:none;"/></a>
                                    </td>
                                    <td width="45%" valign="top" style="width:45.0%;padding:0;">
                                      <p class="MsoNormal"><strong><span style="font-size:9.0pt;font-family:Arial,sans-serif;color:navy;">Contact:</span></strong><br>
                                        <span style="line-height:20px;font-size:9.0pt;font-family:Arial,sans-serif;color:navy;">
                                          Tel: <a target="_blank" href="tel:${escapeHtml(data.telephone || '')}">${escapeHtml(data.telephone || '')}</a><br>
                                          Freephone: <a target="_blank" href="tel:${escapeHtml(data.freephone || '')}">${escapeHtml(data.freephone || '')}</a><br>
                                          Email: <a target="_blank" href="mailto:${escapeHtml(data.franchise_email || '')}">${escapeHtml(data.franchise_email || '')}</a><br>
                                          Web: <a target="_blank" href="${escapeHtml(websiteUrl)}">${escapeHtml(data.website_url || websiteUrl)}</a>
                                        </span>
                                      </p>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td class="footer">
              <p align="center" style="text-align:center;background:#e6e6e8;" class="MsoNormal"><span><b><i><span style="font-size:10.0pt;font-family:Arial,sans-serif;">"Roadcraft professionals for all categories of driving"</span></i></b></span></p>
              <p style="font-family:Arial,sans-serif;text-align:center;font-size:9.5pt;">Please visit our website for <a href="${escapeHtml(contactUrl)}">directions</a> and our <a href="${escapeHtml(termsUrl)}">terms &amp; conditions</a></p>
              <p style="margin-bottom:0;"><img src="${escapeHtml(data.email_footer_url)}" width="786" height="55" alt="1stopinstruction" style="display:block;border:0;outline:none;text-decoration:none;"/></p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </body>
</html>`;
}

function buildBookingConfirmationText(data) {
  return [
    `Booking Ref: ${data.booking_ref} - ${data.booking_type}`,
    `Dear ${data.first_name || 'Customer'},`,
    `Thank you for booking your ${data.course_name} course with 1 Stop Instruction.`,
    '',
    `Name: ${buildPupilName(data)}`.trim(),
    `Course: ${data.course_name || ''}`,
    `Vehicle: ${data.vehicle_type_label || ''}`,
    `Payment Received: ${formatGBP((data.total_amount || 0) - (data.payment_due || 0))}`,
    `Balance Outstanding: ${formatGBP(data.payment_due || 0)}`,
    '',
    `Location: ${[data.location_name, data.address1, data.address2, data.address3, data.address4, data.postcode].filter(Boolean).join(', ')}`,
    '',
    'Kind Regards,',
    '1 Stop Instruction'
  ].join('\n');
}

module.exports = {
  buildSubject,
  buildBookingConfirmationHtml,
  buildBookingConfirmationText
};
