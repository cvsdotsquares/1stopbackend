function siteUrl() {
  const base = String(process.env.PHP_SITE_URL || process.env.SITE_URL || 'https://1stopinstruction.com').replace(
    /\/$/,
    ''
  );
  return `${base}/`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Port of admin/Emails/html/forgot_password.php */
function buildAdminForgotPasswordEmail(adminFirstName, newPassword) {
  const site = siteUrl();
  const firstName = escapeHtml(adminFirstName);
  const password = escapeHtml(newPassword);

  return `<!Doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<title>1stopinstruction.com</title>
</head>
<body style="margin:0; padding:0;">
<div align="center">
  <table width="800" border="0" align="center" style="background: #f5f5f5 none repeat scroll 0 0; border: 1px solid #e0e0e0; padding: 5px;">
    <tbody>
      <tr>
        <td class="header">
          <img src="${site}images/header-img.jpg" width="784" height="177" alt=""/>
        </td>
      </tr>
      <tr>
        <td class="content">
          <table width="100%" border="0" style="background: #ffffff none repeat scroll 0 0; padding: 10px; margin:0;">
            <tbody>
              <tr>
                <td style="font-size:9.0pt;font-family:&quot;Arial&quot;,&quot;sans-serif&quot;"><span style=" float:left;">Dear ${firstName},</span></td>
              </tr>
              <tr>
                <td style="font-size:9.0pt;font-family:&quot;Arial&quot;,&quot;sans-serif&quot;">
                  <p>Your new password is <strong>${password}</strong></p>
                </td>
              </tr>
              <tr>
                <td style="font-size:9.0pt;font-family:&quot;Arial&quot;,&quot;sans-serif&quot;">
                  <p style="margin-top:0px">Please use above password for login into admin dashboard.</p>
                </td>
              </tr>
              <tr>
                <td>&nbsp;</td>
              </tr>
              <tr>
                <td>
                  <table width="100%" border="0">
                    <tbody>
                      <tr>
                        <td><p class="MsoNormal" style="margin: 10px 0px; font-family: arial;"><span><b><i><span style="font-size:13.5pt">1 Stop Instruction</span></i></b></span></p></td>
                      </tr>
                      <tr>
                        <td>
                          <table cellspacing="0" cellpadding="0" border="0" width="99%" style="width:99.0%">
                            <tbody>
                              <tr>
                                <td align="left" valign="middle">
                                  <a href="${site}"><img src="${site}images/logo.png" width="90" alt=""/></a>
                                </td>
                                <td width="45%" valign="top" style="width:45.0%;padding:0in 0in 0in 0in">
                                  <p class="MsoNormal">
                                    <strong><span style="font-size:9.0pt;font-family:&quot;Arial&quot;,&quot;sans-serif&quot;;color:navy">Contact:</span></strong>
                                    <span style="line-height: 20px; font-size:9.0pt;font-family:&quot;Arial&quot;,&quot;sans-serif&quot;;color:navy"><br>
                                    <span>Tel: <a target="_blank" href="tel:020 8597 7333">020 8597 7333</a></span><br>
                                    <span>Freephone: <a target="_blank" href="tel:0800 848 8418">0800 848 8418</a></span><br>
                                    <span>Email: <a target="_blank" href="mailto:info@1stopinstruction.com">info@1stopinstruction.com</a> </span><br>
                                    <span>Web: <a target="_blank" href="www.1stopinstruction.com">www.1stopinstruction.com</a></span></span>
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
          <p align="center" style="text-align:center;background:#e6e6e8" class="MsoNormal"><span><b><i><span style="font-size:10.0pt;font-family:&quot;Arial&quot;,&quot;sans-serif&quot;">"Roadcraft professionals for all categories of driving"</span></i></b></span></p>
          <p style="font-family: Arial, sans-serif; text-align:center; font-size:9.5pt;">Please visit our website for <a href="${site}contactus.php">directions</a> and our <a href="${site}termsandconditions.php">terms &amp; conditions </a></p>
          <p style="margin-bottom:0;"><img src="${site}images/footer-img.jpg" width="786" height="55" alt=""/></p>
        </td>
      </tr>
    </tbody>
  </table>
</div>
</body>
</html>`;
}

module.exports = { buildAdminForgotPasswordEmail };
