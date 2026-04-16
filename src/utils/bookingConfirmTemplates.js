function formatGBP(amount = 0) {
  return `£${Number(amount || 0).toFixed(2)}`;
}

function formatDateDDMMYY(dateStr) {
  if (!dateStr) return 'TBC';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'TBC';
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

function buildSubject(data) {
  return `${data.course_name || 'Course'} Booking Confirmation`;
}

function buildBookingConfirmationHtml(data) {
  const paymentReceived = Number(data.total_amount || 0) - Number(data.payment_due || 0);
  const eventRows = (data.eventDates || [])
    .map((dt) => {
      if (!dt?.event_date || dt.event_date === '0000-00-00') {
        return '<tr><td>TBC</td><td>TBC</td><td>TBC</td></tr>';
      }
      return `
        <tr>
          <td>${formatDateDDMMYY(dt.event_date)}</td>
          <td>${minus15mins(dt.event_start_time)}</td>
          <td>${formatTime12h(dt.event_start_time)}</td>
        </tr>
      `;
    })
    .join('');

  return `
<!doctype html>
<html>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#fff;">
  <div align="center">
    <table width="800" style="background:#f5f5f5;border:1px solid #e0e0e0;padding:5px;">
      <tr>
        <td><img src="${data.email_header_url}" width="784" alt="Header"/></td>
      </tr>

      <tr>
        <td style="background:#fff;padding:10px;">
          <p style="font-size:12px;text-align:right;"><strong>Booking Ref</strong>: ${data.booking_ref} - ${data.booking_type}</p>
          <p style="font-size:12px;">Dear ${data.first_name || 'Customer'},</p>
          <p style="font-size:12px;">Thank you for booking your ${data.course_name} Course with 1 Stop Instruction.</p>
          <p style="font-size:12px;">Please note your booking confirmation details below:</p>

          <table width="100%" style="font-size:12px;">
            <tr>
              <td><strong>Name:</strong></td>
              <td>${(data.first_name || '')} ${(data.sur_name || '')}</td>
              <td><strong>Payment Received:</strong></td>
              <td style="text-align:right;">${formatGBP(paymentReceived)}</td>
            </tr>
            <tr>
              <td><strong>Course:</strong></td>
              <td>${data.course_name || ''}</td>
              <td><strong>Balance Outstanding:</strong></td>
              <td style="text-align:right;">${formatGBP(data.payment_due)}</td>
            </tr>
            <tr>
              <td><strong>Vehicle:</strong></td>
              <td>${data.vehicle_type_label || ''}</td>
              <td></td><td></td>
            </tr>
          </table>

          <hr/>

          <table width="100%" style="font-size:12px;">
            <tr>
              <td width="55%" valign="top">
                <strong><u>Course Location</u></strong><br/>
                ${data.location_name || ''}<br/>
                ${data.address1 || ''}<br/>
                ${data.address2 || ''}<br/>
                ${data.address3 || ''}<br/>
                ${data.address4 || ''}<br/>
                ${data.postcode || ''}
              </td>
              <td width="45%" valign="top">
                <table width="100%" style="font-size:12px;">
                  <tr><td><strong><u>Date</u></strong></td><td><strong><u>Meeting Time</u></strong></td><td><strong><u>Start Time</u></strong></td></tr>
                  ${eventRows}
                </table>
              </td>
            </tr>
          </table>

          <div style="font-size:12px;margin-top:10px;">${data.email_content_html || ''}</div>

          <table width="100%" style="font-size:12px;margin-top:10px;">
            <tr>
              <td><strong>Directions</strong></td>
              <td align="center"><strong>Map of Location</strong></td>
            </tr>
            <tr>
              <td colspan="2">
                <img src="${data.direction_map_url || data.no_map_url}" width="244" style="float:right;margin:10px 0 10px 10px;" alt="Direction map"/>
                ${data.direction_content_html || ''}
              </td>
            </tr>
          </table>

          <p style="font-size:12px;">Kind Regards,</p>
          <p style="font-size:16px;"><strong><em>1 Stop Instruction</em></strong></p>

          <table width="100%" style="font-size:12px;">
            <tr>
              <td><a href="${data.website_url}"><img src="${data.email_logo_url}" width="90" alt="Logo"/></a></td>
              <td>
                <strong>Contact:</strong><br/>
                Tel: <a href="tel:${data.telephone || ''}">${data.telephone || ''}</a><br/>
                Freephone: <a href="tel:${data.freephone || ''}">${data.freephone || ''}</a><br/>
                Email: <a href="mailto:${data.franchise_email || ''}">${data.franchise_email || ''}</a><br/>
                Web: <a href="${data.website_url || '#'}">${data.website_url || ''}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="background:#e6e6e8;text-align:center;font-size:12px;">
          <p><strong><em>"Roadcraft professionals for all categories of driving"</em></strong></p>
          <p>Please visit our website for <a href="${data.contactus_url}">directions</a> and our <a href="${data.terms_url}">terms & conditions</a></p>
          <img src="${data.email_footer_url}" width="786" alt="Footer"/>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>
  `.trim();
}

function buildBookingConfirmationText(data) {
  return [
    `Booking Ref: ${data.booking_ref} - ${data.booking_type}`,
    `Dear ${data.first_name || 'Customer'},`,
    `Thank you for booking your ${data.course_name} course with 1 Stop Instruction.`,
    '',
    `Name: ${(data.first_name || '')} ${(data.sur_name || '')}`.trim(),
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
